const { query } = require('../config/db');
const { renderForEntity } = require('../services/qrBarcodeService');

async function getCodes(req, res) {
    const entityType = String(req.params.entityType || '').toUpperCase();
    const businessId = req.params.businessId;
    const { rows } = await query(
        `SELECT entity_type, entity_id, signed_hash
         FROM qr_barcode_records
         WHERE entity_type = $1 AND entity_id = $2`,
        [entityType, businessId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Codes not found for this record' });

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
