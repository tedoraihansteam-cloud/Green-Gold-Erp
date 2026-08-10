const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { generateForEntity } = require('../services/qrBarcodeService');
const { logAction } = require('../services/auditLogger');
const { recordStockMovement } = require('./inventoryController');
const { recordAccountTransaction } = require('./accountController');
const {createFinancialDocument}=require('../services/financialDocumentService');
const {generateForEntitySafe}=require('../services/qrBarcodeService');

async function createPurchaseOrder(req, res) {
    const { vendorBusinessId, warehouseBusinessId, requisitionBusinessId,purchaseType='INVENTORY',destinationType,destinationBusinessId,destinationName,emergencyPurchase=false,emergencyReason,items, tax, notes } = req.body;
    if (!vendorBusinessId || !destinationType || !destinationName || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Vendor, receiving destination, and at least one item are required' });
    }

    const po = await withTransaction(async (client) => {
        const { rows: vendorRows } = await client.query(
            `SELECT id FROM master_vendors WHERE business_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
            [vendorBusinessId, req.user.company_id]
        );
        if (vendorRows.length === 0) throw Object.assign(new Error('Vendor not found'), { statusCode: 404 });

        const { rows: whRows } = warehouseBusinessId?await client.query(
            `SELECT id FROM warehouses WHERE business_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
            [warehouseBusinessId, req.user.company_id]
        ):{rows:[]};
        if (warehouseBusinessId&&whRows.length === 0) throw Object.assign(new Error('Warehouse not found'), { statusCode: 404 });
        const requisition=requisitionBusinessId?(await client.query(`SELECT * FROM purchase_requisitions WHERE business_id=$1 AND company_id=$2 AND status IN('approved','partially_ordered') FOR UPDATE`,[requisitionBusinessId,req.user.company_id])).rows[0]:null;if(requisitionBusinessId&&!requisition)throw Object.assign(new Error('Approved requisition with remaining items not found'),{statusCode:409});if(!requisition&&!emergencyPurchase)throw Object.assign(new Error('An approved requisition is required unless this is an authorized emergency purchase'),{statusCode:409});if(emergencyPurchase&&!String(emergencyReason||'').trim())throw Object.assign(new Error('Emergency purchase reason is required'),{statusCode:400});

        const businessId = await generateNextId('PURCHASE_ORDER');
        const { rows: poRows } = await client.query(
            `INSERT INTO purchase_orders(business_id,company_id,vendor_id,warehouse_id,requisition_id,purchase_type,destination_type,destination_business_id,destination_name,emergency_purchase,emergency_reason,notes,created_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [businessId,req.user.company_id,vendorRows[0].id,whRows[0]?.id||null,requisition?.id||null,purchaseType,destinationType,destinationBusinessId||null,destinationName,!!emergencyPurchase,emergencyReason||null,notes||null,req.user.id]
        );
        const poRow = poRows[0];

        let subtotal = 0;
        const lineItems = [];
        for (const item of items) {
            if ((!item.productBusinessId&&!item.description) || !item.quantity || Number(item.quantity) <= 0 || item.unitPrice == null) {
                throw Object.assign(new Error('Each item needs a product or description, positive quantity, and unit price'), { statusCode: 400 });
            }
            const { rows: productRows } = item.productBusinessId?await client.query(
                `SELECT id FROM products WHERE business_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
                [item.productBusinessId, req.user.company_id]
            ):{rows:[]};
            if (item.productBusinessId&&productRows.length === 0) throw Object.assign(new Error(`Product not found: ${item.productBusinessId}`), { statusCode: 404 });
            const reqItem=item.requisitionItemId&&requisition?(await client.query(`SELECT id,quantity,quantity_ordered FROM purchase_requisition_items WHERE id=$1 AND requisition_id=$2 FOR UPDATE`,[item.requisitionItemId,requisition.id])).rows[0]:null;
            if(item.requisitionItemId&&!reqItem)throw Object.assign(new Error('Requisition item not found'),{statusCode:409});
            if(reqItem&&Number(item.quantity)>Number(reqItem.quantity)-Number(reqItem.quantity_ordered))throw Object.assign(new Error('PO quantity exceeds the requisition item remaining quantity'),{statusCode:409});

            const lineTotal = Number(item.quantity) * Number(item.unitPrice);
            subtotal += lineTotal;

            const { rows: itemRows } = await client.query(
                `INSERT INTO purchase_order_items(purchase_order_id,product_id,requisition_item_id,item_description,item_type,unit,receiving_action,quantity_ordered,unit_price,line_total)
                 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
                [poRow.id,productRows[0]?.id||null,reqItem?.id||null,item.description||item.productBusinessId,item.itemType||purchaseType,item.unit||'unit',item.receivingAction||((purchaseType==='INVENTORY'||purchaseType==='RAW_MATERIAL')?'STOCK':purchaseType==='SERVICE'?'SERVICE':['MACHINERY','ELECTRICAL','IT_EQUIPMENT','FURNITURE'].includes(purchaseType)?'ASSET':'CONSUMABLE'),item.quantity,item.unitPrice,lineTotal]
            );
            lineItems.push({ ...itemRows[0], productBusinessId: item.productBusinessId });
            if(reqItem)await client.query(`UPDATE purchase_requisition_items SET quantity_ordered=quantity_ordered+$1 WHERE id=$2`,[item.quantity,reqItem.id]);
        }

        const taxAmt = Number(tax) || 0;
        const total = subtotal + taxAmt;
        const { rows: updatedRows } = await client.query(
            `UPDATE purchase_orders SET subtotal = $1, tax = $2, total = $3 WHERE id = $4 RETURNING *`,
            [subtotal, taxAmt, total, poRow.id]
        );
        if(requisition){const pending=(await client.query(`SELECT count(*)::int count FROM purchase_requisition_items WHERE requisition_id=$1 AND quantity_ordered<quantity`,[requisition.id])).rows[0].count;await client.query(`UPDATE purchase_requisitions SET status=$1 WHERE id=$2`,[pending?'partially_ordered':'ordered',requisition.id]);}

        return { ...updatedRows[0], items: lineItems };
    });

    await generateForEntity('PURCHASE_ORDER', po.business_id);
    await logAction({ actorUserId: req.user.id, action: 'PURCHASE_ORDER_CREATED', entityType: 'PURCHASE_ORDER', entityId: po.business_id, after: { total: po.total, vendorBusinessId } });
    res.status(201).json({ purchaseOrder: po });
}

async function listPurchaseOrders(req, res) {
    const { status } = req.query;
    const { rows } = await query(
        `SELECT po.*, v.business_id AS vendor_business_id, v.name AS vendor_name, w.business_id AS warehouse_business_id,pr.business_id requisition_business_id
         FROM purchase_orders po
         JOIN master_vendors v ON v.id = po.vendor_id
         LEFT JOIN warehouses w ON w.id = po.warehouse_id LEFT JOIN purchase_requisitions pr ON pr.id=po.requisition_id
         WHERE po.company_id = $1 AND ($2::text IS NULL OR po.status = $2)
         ORDER BY po.created_at DESC`,
        [req.user.company_id, status || null]
    );
    res.json({ purchaseOrders: rows });
}

async function getPurchaseOrder(req, res) {
    const { rows: poRows } = await query(
        `SELECT po.*, v.business_id AS vendor_business_id, v.name AS vendor_name, w.business_id AS warehouse_business_id,pr.business_id requisition_business_id
         FROM purchase_orders po
         JOIN master_vendors v ON v.id = po.vendor_id
         LEFT JOIN warehouses w ON w.id = po.warehouse_id LEFT JOIN purchase_requisitions pr ON pr.id=po.requisition_id
         WHERE po.business_id = $1 AND po.company_id = $2`,
        [req.params.businessId, req.user.company_id]
    );
    if (poRows.length === 0) return res.status(404).json({ error: 'Purchase order not found' });

    const { rows: items } = await query(
        `SELECT poi.*, p.business_id AS product_business_id,COALESCE(p.name,poi.item_description) AS product_name,COALESCE(p.unit,poi.unit) unit
         FROM purchase_order_items poi LEFT JOIN products p ON p.id = poi.product_id
         WHERE poi.purchase_order_id = $1`,
        [poRows[0].id]
    );
    const { rows: receipts } = await query(
        `SELECT r.*, u.username AS received_by_username
         FROM purchase_order_receipts r JOIN users u ON u.id = r.received_by
         WHERE r.purchase_order_id = $1 ORDER BY r.received_at DESC`,
        [poRows[0].id]
    );

    res.json({ purchaseOrder: { ...poRows[0], items, receipts } });
}

/**
 * Records a shipment against a PO: each line's quantity_received goes up,
 * stock actually moves via the same recordStockMovement function every
 * other stock-changing action uses, and the PO's overall status reflects
 * whether everything ordered has now arrived.
 */
async function receiveGoods(req, res) {
    const { items, deliveryNoteRef, notes,conditionStatus='good',acceptedByName,inspectionNotes } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'At least one received item is required' });
    }

    const result = await withTransaction(async (client) => {
        const assetBusinessIds=[];
        const { rows: poRows } = await client.query(
            `SELECT * FROM purchase_orders WHERE business_id = $1 AND company_id = $2 FOR UPDATE`,
            [req.params.businessId, req.user.company_id]
        );
        if (poRows.length === 0) throw Object.assign(new Error('Purchase order not found'), { statusCode: 404 });
        const po = poRows[0];
        if (!['issued', 'partially_received'].includes(po.status)) {
            throw Object.assign(new Error(`Cannot receive goods against a ${po.status} purchase order`), { statusCode: 409 });
        }

        const { rows: receiptRows } = await client.query(
            `INSERT INTO purchase_order_receipts(purchase_order_id,received_by,delivery_note_ref,notes,receipt_type,destination_type,destination_business_id,destination_name,condition_status,accepted_by_name,inspection_notes)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [po.id,req.user.id,deliveryNoteRef||null,notes||null,po.purchase_type==='SERVICE'?'SERVICE_COMPLETION':po.purchase_type==='INVENTORY'?'GRN':'GENERAL_RECEIPT',po.destination_type,po.destination_business_id,po.destination_name,conditionStatus,acceptedByName||null,inspectionNotes||null]
        );
        const receipt = receiptRows[0];

        for (const item of items) {
            if (!item.poItemId) {
                throw Object.assign(new Error('Each received item needs poItemId'), { statusCode: 400 });
            }
            const { rows: itemRows } = await client.query(
                `SELECT * FROM purchase_order_items WHERE id = $1 AND purchase_order_id = $2 FOR UPDATE`,
                [item.poItemId, po.id]
            );
            if (itemRows.length === 0) throw Object.assign(new Error('Purchase order line item not found'), { statusCode: 404 });
            const poItem = itemRows[0];

            const remaining = Number(poItem.quantity_ordered) - Number(poItem.quantity_received);
            const receivingNow = Number(item.quantity);
            if (receivingNow <= 0) throw Object.assign(new Error('quantity must be positive'), { statusCode: 400 });
            if (receivingNow > remaining + 0.0001) {
                throw Object.assign(new Error(`Cannot receive ${receivingNow} - only ${remaining} remains on this line`), { statusCode: 409 });
            }

            await client.query(
                `UPDATE purchase_order_items SET quantity_received = quantity_received + $1 WHERE id = $2`,
                [receivingNow, poItem.id]
            );
            await client.query(
                `INSERT INTO purchase_order_receipt_items(receipt_id,po_item_id,quantity,serial_numbers,warranty_until,condition_status,remarks) VALUES($1,$2,$3,$4,$5,$6,$7)`,
                [receipt.id,poItem.id,receivingNow,JSON.stringify(item.serialNumbers||[]),item.warrantyUntil||null,item.conditionStatus||conditionStatus,item.remarks||null]
            );

            if(poItem.receiving_action==='STOCK'){if(!poItem.product_id||!po.warehouse_id)throw Object.assign(new Error('Stock receipt requires a product and warehouse destination'),{statusCode:409});await recordStockMovement(client, {
                productId: poItem.product_id, warehouseId: po.warehouse_id, movementType: 'IN',
                quantity: receivingNow, referenceType: 'PURCHASE_ORDER', referenceId: po.business_id, createdBy: req.user.id
            });}else if(poItem.receiving_action==='ASSET'){for(let n=0;n<Math.ceil(receivingNow);n++){const assetId=await generateNextId('PROCURED_ASSET');await client.query(`INSERT INTO procured_assets(business_id,company_id,po_item_id,receipt_id,asset_type,name,serial_number,destination_type,destination_business_id,destination_name,condition_status,warranty_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[assetId,req.user.company_id,poItem.id,receipt.id,poItem.item_type,poItem.item_description,(item.serialNumbers||[])[n]||null,po.destination_type,po.destination_business_id,po.destination_name,item.conditionStatus||conditionStatus,item.warrantyUntil||null]);assetBusinessIds.push(assetId);}}
        }

        const { rows: allItems } = await client.query(`SELECT quantity_ordered, quantity_received FROM purchase_order_items WHERE purchase_order_id = $1`, [po.id]);
        const fullyReceived = allItems.every((i) => Number(i.quantity_received) >= Number(i.quantity_ordered) - 0.0001);
        const newStatus = fullyReceived ? 'received' : 'partially_received';

        const { rows: updatedPo } = await client.query(`UPDATE purchase_orders SET status = $1 WHERE id = $2 RETURNING *`, [newStatus, po.id]);

        return { po: updatedPo[0], receipt,assetBusinessIds };
    });

    await logAction({ actorUserId: req.user.id, action: 'PURCHASE_ORDER_RECEIVED', entityType: 'PURCHASE_ORDER', entityId: result.po.business_id, after: { status: result.po.status } });
    for(const id of result.assetBusinessIds||[])await generateForEntitySafe('PROCURED_ASSET',id);
    res.status(201).json({ purchaseOrder: result.po, receipt: result.receipt });
}

async function cancelPurchaseOrder(req, res) {
    const { reason } = req.body;
    const { rows: existingRows } = await query(`SELECT amount_paid FROM purchase_orders WHERE business_id = $1 AND company_id = $2`, [req.params.businessId, req.user.company_id]);
    if (existingRows.length > 0 && Number(existingRows[0].amount_paid) > 0) {
        return res.status(409).json({ error: 'Cannot cancel a purchase order with payments recorded - the funds may already be with the vendor, so this needs a deliberate refund arrangement, not an automatic reversal' });
    }

    const { rows } = await query(
        `UPDATE purchase_orders SET status = 'cancelled', cancelled_by = $1, cancelled_at = now(), cancel_reason = $2
         WHERE business_id = $3 AND company_id = $4 AND status = 'issued'
         RETURNING *`,
        [req.user.id, reason || null, req.params.businessId, req.user.company_id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Purchase order not found, or already received/cancelled' });
    await logAction({ actorUserId: req.user.id, action: 'PURCHASE_ORDER_CANCELLED', entityType: 'PURCHASE_ORDER', entityId: rows[0].business_id, after: { reason } });
    res.json({ message: 'Purchase order cancelled', purchaseOrder: rows[0] });
}

/**
 * Records a payment to the vendor and posts a real withdrawal, using the
 * same recordAccountTransaction function every other money-moving action
 * uses. Unlike invoice payments, this is allowed regardless of receiving
 * status - paying a vendor a deposit before goods arrive is normal
 * procurement practice.
 */
async function recordPayment(req, res) {
    const { accountBusinessId, amount, paymentMethod, reference, paymentDate } = req.body;
    if (!accountBusinessId || !amount || Number(amount) <= 0) {
        return res.status(400).json({ error: 'accountBusinessId and a positive amount are required' });
    }

    const result = await withTransaction(async (client) => {
        const { rows: poRows } = await client.query(
            `SELECT * FROM purchase_orders WHERE business_id = $1 AND company_id = $2 FOR UPDATE`,
            [req.params.businessId, req.user.company_id]
        );
        if (poRows.length === 0) throw Object.assign(new Error('Purchase order not found'), { statusCode: 404 });
        const po = poRows[0];
        if (po.status === 'cancelled') {
            throw Object.assign(new Error('Cannot pay a cancelled purchase order'), { statusCode: 409 });
        }

        const balanceDue = Number(po.total) - Number(po.amount_paid);
        if (Number(amount) > balanceDue + 0.01) {
            throw Object.assign(new Error(`Payment of ${amount} exceeds the balance due of ${balanceDue.toFixed(2)}`), { statusCode: 409 });
        }

        const { rows: accountRows } = await client.query(
            `SELECT id FROM accounts WHERE business_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
            [accountBusinessId, req.user.company_id]
        );
        if (accountRows.length === 0) throw Object.assign(new Error('Account not found'), { statusCode: 404 });

        const { rows: paymentRows } = await client.query(
            `INSERT INTO purchase_order_payments (purchase_order_id, account_id, amount, payment_method, reference, payment_date, paid_by)
             VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE), $7) RETURNING *`,
            [po.id, accountRows[0].id, amount, paymentMethod || 'cash', reference || null, paymentDate, req.user.id]
        );

        // This throws (rolling back the whole payment) if the account can't cover it.
        await recordAccountTransaction(client, {
            accountId: accountRows[0].id, transactionType: 'WITHDRAWAL', amount, referenceType: 'PURCHASE_ORDER_PAYMENT',
            referenceId: po.business_id, createdBy: req.user.id, notes: `Inventory purchase payment for ${po.business_id}`,financialClassification:'INVENTORY_PURCHASE'
        });
        const voucher=await createFinancialDocument(client,{companyId:req.user.company_id,documentType:'PAYMENT_VOUCHER',accountId:accountRows[0].id,vendorId:po.vendor_id,sourceType:'PURCHASE_ORDER_PAYMENT',sourceId:paymentRows[0].id,amount,description:`Purchase payment ${po.business_id}`,createdBy:req.user.id});
        await client.query(`UPDATE purchase_order_payments SET voucher_business_id=$1 WHERE id=$2`,[voucher.business_id,paymentRows[0].id]);paymentRows[0].voucher_business_id=voucher.business_id;

        const newAmountPaid = Number(po.amount_paid) + Number(amount);
        const newPaymentStatus = newAmountPaid >= Number(po.total) - 0.01 ? 'paid' : 'partially_paid';
        const { rows: updatedPo } = await client.query(
            `UPDATE purchase_orders SET amount_paid = $1, payment_status = $2 WHERE id = $3 RETURNING *`,
            [newAmountPaid, newPaymentStatus, po.id]
        );

        return { po: updatedPo[0], payment: paymentRows[0] };
    });

    await logAction({
        actorUserId: req.user.id, action: 'PURCHASE_ORDER_PAYMENT_RECORDED', entityType: 'PURCHASE_ORDER', entityId: result.po.business_id,
        after: { amount, paymentStatus: result.po.payment_status }
    });
    await generateForEntitySafe('PAYMENT_VOUCHER',result.payment.voucher_business_id);
    res.status(201).json({ purchaseOrder: result.po, payment: result.payment });
}

async function acceptPayment(req,res){const {notes}=req.body;if(!String(notes||'').trim())return res.status(400).json({error:'Acceptance remarks are required'});const {rows}=await query(`UPDATE purchase_order_payments pp SET accepted_by=$1,accepted_at=now(),acceptance_notes=$2 FROM purchase_orders po WHERE pp.id=$3 AND pp.purchase_order_id=po.id AND po.company_id=$4 AND pp.accepted_at IS NULL RETURNING pp.*`,[req.user.id,notes,req.params.paymentId,req.user.company_id]);if(!rows.length)return res.status(409).json({error:'Payment not found or already accepted'});res.json({payment:rows[0]});}
async function reconcilePayment(req,res){const {reference}=req.body;if(!String(reference||'').trim())return res.status(400).json({error:'Bank/cash reconciliation reference is required'});const {rows}=await query(`UPDATE purchase_order_payments pp SET reconciled_by=$1,reconciled_at=now(),reconciliation_reference=$2 FROM purchase_orders po WHERE pp.id=$3 AND pp.purchase_order_id=po.id AND po.company_id=$4 AND pp.reconciled_at IS NULL RETURNING pp.*`,[req.user.id,reference,req.params.paymentId,req.user.company_id]);if(!rows.length)return res.status(409).json({error:'Payment not found or already reconciled'});res.json({payment:rows[0]});}

async function listPayments(req, res) {
    const { rows: poRows } = await query(`SELECT id FROM purchase_orders WHERE business_id = $1 AND company_id = $2`, [req.params.businessId, req.user.company_id]);
    if (poRows.length === 0) return res.status(404).json({ error: 'Purchase order not found' });

    const { rows } = await query(
        `SELECT pp.*, a.business_id AS account_business_id, a.name AS account_name, u.username AS paid_by_username
         FROM purchase_order_payments pp
         JOIN accounts a ON a.id = pp.account_id
         JOIN users u ON u.id = pp.paid_by
         WHERE pp.purchase_order_id = $1 ORDER BY pp.created_at DESC`,
        [poRows[0].id]
    );
    res.json({ payments: rows });
}

module.exports = { createPurchaseOrder, listPurchaseOrders, getPurchaseOrder, receiveGoods, cancelPurchaseOrder, recordPayment, listPayments,acceptPayment,reconcilePayment };
