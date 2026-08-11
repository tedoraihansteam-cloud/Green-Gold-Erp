const { query } = require('../config/db');
const { generateForEntity, renderForEntity } = require('../services/qrBarcodeService');

const ENTITY_TABLES = {
    CUSTOMER: 'master_customers', EMPLOYEE: 'master_employees', VENDOR: 'master_vendors',
    PRODUCT: 'products', WAREHOUSE: 'warehouses', STORAGE_LOCATION: 'storage_locations',
    PRODUCT_BATCH: 'product_batches', GOODS_RECEIPT: 'goods_receipts', PAYROLL_RUN: 'payroll_runs',
    BILL_SUBMISSION: 'bill_submissions', CUSTOMER_PAYMENT: 'customer_payments',
    MONEY_RECEIPT: 'financial_documents', STOCK_RELEASE: 'stock_release_documents',
    BULK_IMPORT: 'bulk_import_jobs'
};

async function ensureOwnedCode(entityType, businessId, companyId) {
    const table = ENTITY_TABLES[entityType];
    if (!table) return false;
    const exists = (await query(`SELECT 1 FROM ${table} WHERE business_id=$1 AND company_id=$2 LIMIT 1`, [businessId, companyId])).rows.length > 0;
    if (!exists) return false;
    await generateForEntity(entityType, businessId);
    return true;
}

async function getCodes(req, res) {
    const entityType = String(req.params.entityType || '').toUpperCase();
    const businessId = req.params.businessId;
    const { rows } = await query(
        `SELECT entity_type, entity_id, signed_hash
         FROM qr_barcode_records
         WHERE entity_type = $1 AND entity_id = $2`,
        [entityType, businessId]
    );
    if (rows.length === 0) {
        if (!await ensureOwnedCode(entityType, businessId, req.user.company_id)) return res.status(404).json({ error: 'Record not found or this record type does not support codes' });
        rows.push((await query(`SELECT entity_type,entity_id,signed_hash FROM qr_barcode_records WHERE entity_type=$1 AND entity_id=$2`, [entityType, businessId])).rows[0]);
    }

    const rendered = await renderForEntity(entityType, businessId, rows[0].signed_hash);
    res.json({
        entityType,
        businessId,
        qrUrl: `data:image/png;base64,${rendered.qrPng.toString('base64')}`,
        barcodeUrl: `data:image/png;base64,${rendered.barcodePng.toString('base64')}`
    });
}

async function image(req, res) {
    const entityType = String(req.params.entityType || '').toUpperCase();
    const businessId = req.params.businessId;
    const { rows } = await query(`SELECT signed_hash FROM qr_barcode_records WHERE entity_type=$1 AND entity_id=$2`, [entityType, businessId]);
    if (!rows.length) return res.status(404).json({ error: 'Codes not found for this record' });
    const rendered = await renderForEntity(entityType, businessId, rows[0].signed_hash);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(req.params.kind === 'qr' ? rendered.qrPng : rendered.barcodePng);
}

module.exports = { getCodes, image };
