const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { generateForEntity } = require('../services/qrBarcodeService');
const { logAction } = require('../services/auditLogger');
const { recordStockMovement } = require('./inventoryController');
const { createReceivable, cancelReceivable } = require('../services/receivableService');
const { accrueRentForCompany } = require('./batchController');

/**
 * Creates an invoice and decrements stock in the same transaction - if
 * any line item doesn't have enough stock, the whole invoice is rejected
 * rather than partially applied. This is the pattern the eventual
 * Accounts module's auto-posting will hook into (rule #11: operational
 * transactions should create the accounting entry automatically).
 */
async function createInvoice(req, res) {
    const { customerBusinessId, warehouseBusinessId, items, discount, tax, notes, dueDate } = req.body;

    if (!customerBusinessId || !warehouseBusinessId || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'customerBusinessId, warehouseBusinessId, and at least one item are required' });
    }
    await accrueRentForCompany(req.user.company_id);

    const invoice = await withTransaction(async (client) => {
        const { rows: customerRows } = await client.query(
            `SELECT id, credit_period_days FROM master_customers WHERE business_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
            [customerBusinessId, req.user.company_id]
        );
        if (customerRows.length === 0) throw Object.assign(new Error('Customer not found'), { statusCode: 404 });
        const customerId = customerRows[0].id;

        const { rows: warehouseRows } = await client.query(
            `SELECT id FROM warehouses WHERE business_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
            [warehouseBusinessId, req.user.company_id]
        );
        if (warehouseRows.length === 0) throw Object.assign(new Error('Warehouse not found'), { statusCode: 404 });
        const warehouseId = warehouseRows[0].id;

        const businessId = await generateNextId('INVOICE');
        const { rows: invoiceRows } = await client.query(
            `INSERT INTO sales_invoices (business_id, company_id, customer_id, warehouse_id, issued_by, notes, due_date, payment_status)
             VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date,CURRENT_DATE+($8::integer)),'unpaid') RETURNING *`,
            [businessId, req.user.company_id, customerId, warehouseId, req.user.id, notes || null, dueDate || null, customerRows[0].credit_period_days]
        );
        const invoiceRow = invoiceRows[0];

        let subtotal = 0;
        const lineItems = [];

        for (const item of items) {
            if (!item.productBusinessId || !item.quantity || Number(item.quantity) <= 0) {
                throw Object.assign(new Error('Each item needs productBusinessId and a positive quantity'), { statusCode: 400 });
            }

            const { rows: productRows } = await client.query(
                `SELECT id, unit_price FROM products WHERE business_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
                [item.productBusinessId, req.user.company_id]
            );
            if (productRows.length === 0) {
                throw Object.assign(new Error(`Product not found: ${item.productBusinessId}`), { statusCode: 404 });
            }
            const product = productRows[0];
            const unitPrice = item.unitPrice != null ? Number(item.unitPrice) : Number(product.unit_price);
            const lineTotal = unitPrice * Number(item.quantity);
            subtotal += lineTotal;

            // This throws (and rolls back the whole invoice) if stock is insufficient.
            await recordStockMovement(client, {
                productId: product.id,
                warehouseId,
                movementType: 'OUT',
                quantity: item.quantity,
                referenceType: 'SALE',
                referenceId: businessId,
                createdBy: req.user.id
            });

            let batchId = null;
            if (item.batchBusinessId) {
                const { rows: batches } = await client.query(
                    `SELECT id,available_quantity FROM product_batches WHERE business_id=$1 AND product_id=$2 AND company_id=$3 AND status='available' FOR UPDATE`,
                    [item.batchBusinessId,product.id,req.user.company_id]
                );
                if (!batches.length || Number(batches[0].available_quantity) < Number(item.quantity)) throw Object.assign(new Error(`Insufficient batch quantity: ${item.batchBusinessId}`), { statusCode: 409 });
                batchId = batches[0].id;
                const previousBatchQuantity=Number(batches[0].available_quantity);
                const { rows: placements } = await client.query(
                    `SELECT blb.location_id,blb.quantity FROM batch_location_balances blb JOIN storage_locations sl ON sl.id=blb.location_id
                     WHERE blb.batch_id=$1 AND sl.warehouse_id=$2 AND blb.quantity>0 ORDER BY blb.updated_at FOR UPDATE`, [batchId,warehouseId]
                );
                let remaining = Number(item.quantity);
                for (const placement of placements) {
                    if (remaining <= 0) break;
                    const taken = Math.min(Number(placement.quantity),remaining);
                    await client.query(`UPDATE batch_location_balances SET quantity=quantity-$1,updated_at=now() WHERE batch_id=$2 AND location_id=$3`,[taken,batchId,placement.location_id]);
                    await client.query(`INSERT INTO batch_movements(batch_id,from_location_id,movement_type,quantity,reference_type,reference_id,created_by) VALUES($1,$2,'OUT',$3,'SALE',$4,$5)`,[batchId,placement.location_id,taken,businessId,req.user.id]);
                    await client.query(`UPDATE product_batch_units SET status='delivered',location_id=NULL WHERE id IN(SELECT id FROM product_batch_units WHERE batch_id=$1 AND location_id=$2 AND status='stored' ORDER BY unit_number LIMIT $3)`,[batchId,placement.location_id,Math.floor(taken)]);
                    remaining -= taken;
                }
                if (remaining > 0.0001) throw Object.assign(new Error(`Batch ${item.batchBusinessId} is not stored in the selected warehouse`), { statusCode: 409 });
                await client.query(`UPDATE product_batches SET available_quantity=available_quantity-$1,status=CASE WHEN available_quantity-$1=0 THEN 'dispatched' ELSE status END WHERE id=$2`,[item.quantity,batchId]);
                const releaseBusinessId=await generateNextId('STOCK_RELEASE');
                await client.query(`INSERT INTO stock_release_documents(business_id,company_id,customer_id,batch_id,quantity,previous_quantity,remaining_quantity,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[releaseBusinessId,req.user.company_id,customerId,batchId,item.quantity,previousBatchQuantity,previousBatchQuantity-Number(item.quantity),req.user.id]);
                item.stockReleaseBusinessId=releaseBusinessId;
            }

            const { rows: itemRows } = await client.query(
                `INSERT INTO sales_invoice_items (invoice_id, product_id, batch_id, quantity, unit_price, line_total)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [invoiceRow.id, product.id, batchId, item.quantity, unitPrice, lineTotal]
            );
            lineItems.push({ ...itemRows[0], productBusinessId: item.productBusinessId, stockReleaseBusinessId:item.stockReleaseBusinessId });
        }

        const discountAmt = Number(discount) || 0;
        const taxAmt = Number(tax) || 0;
        const total = subtotal - discountAmt + taxAmt;

        const { rows: updatedRows } = await client.query(
            `UPDATE sales_invoices SET subtotal = $1, discount = $2, tax = $3, total = $4 WHERE id = $5 RETURNING *`,
            [subtotal, discountAmt, taxAmt, total, invoiceRow.id]
        );

        await createReceivable(client,{companyId:req.user.company_id,customerId,sourceType:'SALES_INVOICE',sourceId:businessId,description:`Sales invoice ${businessId}`,amount:total,dueDate:updatedRows[0].due_date});

        return { ...updatedRows[0], items: lineItems };
    });

    await generateForEntity('INVOICE', invoice.business_id);
    for(const item of invoice.items)if(item.stockReleaseBusinessId)await generateForEntity('STOCK_RELEASE',item.stockReleaseBusinessId);
    await logAction({
        actorUserId: req.user.id, action: 'INVOICE_CREATED', entityType: 'INVOICE', entityId: invoice.business_id,
        after: { total: invoice.total, customerBusinessId, itemCount: invoice.items.length }
    });

    res.status(201).json({ invoice });
}

async function listInvoices(req, res) {
    const { rows } = await query(
        `SELECT si.*, c.business_id AS customer_business_id, c.name AS customer_name,
                cr.original_amount-cr.paid_amount AS outstanding_amount
         FROM sales_invoices si
         JOIN master_customers c ON c.id = si.customer_id
         LEFT JOIN customer_receivables cr ON cr.source_type='SALES_INVOICE' AND cr.source_id=si.business_id
         WHERE si.company_id = $1
         ORDER BY si.created_at DESC`,
        [req.user.company_id]
    );
    res.json({ invoices: rows });
}

async function getInvoice(req, res) {
    const { rows: invoiceRows } = await query(
        `SELECT si.*, c.business_id AS customer_business_id, c.name AS customer_name,c.phone AS customer_phone,c.email AS customer_email,c.address AS customer_address,c.customer_type,
                w.business_id AS warehouse_business_id,w.name AS warehouse_name,cr.original_amount-cr.paid_amount AS outstanding_amount,
                co.name AS company_name,cp.tagline AS company_tagline,cp.phone AS company_phone,cp.email AS company_email,cp.website AS company_website,cp.registration_number,cp.tax_number,
                (SELECT address FROM company_sites cs WHERE cs.company_id=si.company_id ORDER BY cs.is_document_address DESC,cs.created_at LIMIT 1) AS company_address
         FROM sales_invoices si
         JOIN master_customers c ON c.id = si.customer_id
         JOIN warehouses w ON w.id = si.warehouse_id
         JOIN companies co ON co.id=si.company_id
         LEFT JOIN company_profiles cp ON cp.company_id=si.company_id
         LEFT JOIN customer_receivables cr ON cr.source_type='SALES_INVOICE' AND cr.source_id=si.business_id
         WHERE si.business_id = $1 AND si.company_id = $2`,
        [req.params.businessId, req.user.company_id]
    );
    if (invoiceRows.length === 0) return res.status(404).json({ error: 'Invoice not found' });

    const { rows: itemRows } = await query(
        `SELECT sii.*, p.business_id AS product_business_id, p.name AS product_name, pb.business_id AS batch_business_id
         FROM sales_invoice_items sii
         JOIN products p ON p.id = sii.product_id
         LEFT JOIN product_batches pb ON pb.id=sii.batch_id
         WHERE sii.invoice_id = $1`,
        [invoiceRows[0].id]
    );

    res.json({ invoice: { ...invoiceRows[0], items: itemRows } });
}

/**
 * Cancelling an invoice reverses the stock movement rather than deleting
 * anything - both the original OUT and the reversal IN stay in the
 * ledger, so the full history is visible (architecture rule: immutable
 * audit trail).
 */
async function cancelInvoice(req, res) {
    const { reason } = req.body;

    const cancelled = await withTransaction(async (client) => {
        const { rows } = await client.query(
            `SELECT * FROM sales_invoices WHERE business_id = $1 AND company_id = $2 FOR UPDATE`,
            [req.params.businessId, req.user.company_id]
        );
        if (rows.length === 0) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 });
        const invoice = rows[0];
        if (invoice.status === 'cancelled') {
            throw Object.assign(new Error('Invoice is already cancelled'), { statusCode: 409 });
        }

        const { rows: itemRows } = await client.query(
            `SELECT * FROM sales_invoice_items WHERE invoice_id = $1`,
            [invoice.id]
        );
        for (const item of itemRows) {
            await recordStockMovement(client, {
                productId: item.product_id,
                warehouseId: invoice.warehouse_id,
                movementType: 'IN',
                quantity: item.quantity,
                referenceType: 'SALE_CANCELLED',
                referenceId: invoice.business_id,
                createdBy: req.user.id,
                notes: reason || null
            });
            if (item.batch_id) {
                const { rows: movements } = await client.query(`SELECT from_location_id,quantity FROM batch_movements WHERE batch_id=$1 AND reference_type='SALE' AND reference_id=$2 AND movement_type='OUT' FOR UPDATE`,[item.batch_id,invoice.business_id]);
                for (const movement of movements) {
                    await client.query(`INSERT INTO batch_location_balances(batch_id,location_id,quantity) VALUES($1,$2,$3) ON CONFLICT(batch_id,location_id) DO UPDATE SET quantity=batch_location_balances.quantity+EXCLUDED.quantity,updated_at=now()`,[item.batch_id,movement.from_location_id,movement.quantity]);
                    await client.query(`INSERT INTO batch_movements(batch_id,to_location_id,movement_type,quantity,reference_type,reference_id,created_by,notes) VALUES($1,$2,'RETURN',$3,'SALE_CANCELLED',$4,$5,$6)`,[item.batch_id,movement.from_location_id,movement.quantity,invoice.business_id,req.user.id,reason||null]);
                    await client.query(`UPDATE product_batch_units SET status='stored',location_id=$1 WHERE id IN(SELECT id FROM product_batch_units WHERE batch_id=$2 AND status='delivered' ORDER BY unit_number LIMIT $3)`,[movement.from_location_id,item.batch_id,Math.floor(Number(movement.quantity))]);
                }
                await client.query(`UPDATE product_batches SET available_quantity=available_quantity+$1,status='available' WHERE id=$2`,[item.quantity,item.batch_id]);
            }
        }

        if (invoice.payment_status === 'legacy' && invoice.payment_account_id) {
            const { recordAccountTransaction } = require('./accountController');
            await recordAccountTransaction(client,{accountId:invoice.payment_account_id,transactionType:'WITHDRAWAL',amount:invoice.total,referenceType:'INVOICE_CANCELLATION',referenceId:invoice.business_id,createdBy:req.user.id,notes:`Reversal of legacy sales invoice ${invoice.business_id}`});
        } else {
            await cancelReceivable(client,'SALES_INVOICE',invoice.business_id);
        }

        const { rows: updatedRows } = await client.query(
            `UPDATE sales_invoices SET status = 'cancelled', payment_status='cancelled', cancelled_at = now(), cancelled_by = $1, cancel_reason = $2
             WHERE id = $3 RETURNING *`,
            [req.user.id, reason || null, invoice.id]
        );
        return updatedRows[0];
    });

    await logAction({ actorUserId: req.user.id, action: 'INVOICE_CANCELLED', entityType: 'INVOICE', entityId: cancelled.business_id, after: { reason } });
    res.json({ message: 'Invoice cancelled, stock reversed', invoice: cancelled });
}

module.exports = { createInvoice, listInvoices, getInvoice, cancelInvoice };
