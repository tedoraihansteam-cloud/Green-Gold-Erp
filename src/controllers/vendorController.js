const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { generateForEntity } = require('../services/qrBarcodeService');
const { logAction } = require('../services/auditLogger');

async function createVendor(req, res) {
    const { name, phone, email, address, vendorType } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'name is required' });
    }

    const vendor = await withTransaction(async (client) => {
        const businessId = await generateNextId('VENDOR');
        const { rows } = await client.query(
            `INSERT INTO master_vendors (business_id, company_id, name, phone, email, address, vendor_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [businessId, req.user.company_id, name, phone || null, email || null, address || null, vendorType || null]
        );
        return rows[0];
    });

    await generateForEntity('VENDOR', vendor.business_id);
    await logAction({ actorUserId: req.user.id, action: 'VENDOR_CREATED', entityType: 'VENDOR', entityId: vendor.business_id, after: vendor });

    res.status(201).json({ vendor });
}

async function listVendors(req, res) {
    const { rows } = await query(
        `SELECT * FROM master_vendors WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
        [req.user.company_id]
    );
    res.json({ vendors: rows });
}

async function getVendor(req, res) {
    const { rows } = await query(
        `SELECT * FROM master_vendors WHERE business_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [req.params.businessId, req.user.company_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    const vendor = rows[0];
    const [purchaseOrders, payments, bills] = await Promise.all([
        query(`SELECT po.business_id,po.purchase_type,po.destination_name,po.subtotal,po.tax,po.total,po.amount_paid,po.payment_status,po.status,po.created_at,
          (SELECT json_agg(json_build_object('description',COALESCE(p.name,poi.item_description),'itemType',poi.item_type,'quantity',poi.quantity_ordered,'received',poi.quantity_received,'unit',poi.unit,'unitPrice',poi.unit_price,'lineTotal',poi.line_total) ORDER BY poi.id) FROM purchase_order_items poi LEFT JOIN products p ON p.id=poi.product_id WHERE poi.purchase_order_id=po.id) items
          FROM purchase_orders po WHERE po.vendor_id=$1 ORDER BY po.created_at DESC`, [vendor.id]),
        query(`SELECT pop.id,pop.amount,pop.payment_date,pop.reference,CASE WHEN pop.reconciled_at IS NOT NULL THEN 'reconciled' WHEN pop.accepted_at IS NOT NULL THEN 'accepted' ELSE 'paid' END status,pop.created_at,po.business_id purchase_order_business_id,a.business_id account_business_id,a.name account_name
          FROM purchase_order_payments pop JOIN purchase_orders po ON po.id=pop.purchase_order_id LEFT JOIN accounts a ON a.id=pop.account_id WHERE po.vendor_id=$1 ORDER BY pop.created_at DESC`, [vendor.id]),
        query(`SELECT business_id,category bill_type,payee,amount total_amount,status,submitted_at,paid_at FROM bill_submissions WHERE vendor_id=$1 ORDER BY created_at DESC`, [vendor.id])
    ]);
    res.json({ vendor: { ...vendor, purchaseOrders: purchaseOrders.rows, payments: payments.rows, bills: bills.rows } });
}

module.exports = { createVendor, listVendors, getVendor };
