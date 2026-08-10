const crypto = require('crypto');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
const { query } = require('../config/db');

/**
 * Signs an entityType + businessId pair so a scanned QR code can be
 * verified as genuinely issued by this system, not hand-crafted.
 */
function signPayload(entityType, businessId) {
    const secret = process.env.QR_SIGNING_SECRET;
    if (!secret) {
        throw new Error('QR_SIGNING_SECRET is not set - refusing to generate an unsigned QR code');
    }
    return crypto
        .createHmac('sha256', secret)
        .update(`${entityType}:${businessId}`)
        .digest('hex');
}

/**
 * Generates a QR code (JSON payload with business id, entity type, signed
 * hash, and optional lookup URL) and a Code128 barcode (business id only)
 * for a given entity, saves both as PNG files, and records the metadata.
 *
 * @param {string} entityType - e.g. 'CUSTOMER', 'INVOICE', 'GATE_PASS'
 * @param {string} businessId - the permanent business id, e.g. 'INV-20260801-000001'
 */
async function generateForEntity(entityType, businessId) {
    const signedHash = signPayload(entityType, businessId);
    await query(
        `INSERT INTO qr_barcode_records (entity_type, entity_id, qr_file_path, barcode_file_path, signed_hash)
         VALUES ($1, $2, '', '', $3)
         ON CONFLICT (entity_type, entity_id)
         DO UPDATE SET qr_file_path = '', barcode_file_path = '', signed_hash = EXCLUDED.signed_hash`,
        [entityType, businessId, signedHash]
    );
    return { signedHash };
}

async function renderForEntity(entityType, businessId, knownSignedHash = null) {
    const signedHash = knownSignedHash || signPayload(entityType, businessId);
    const qrPayload = JSON.stringify({
        id: businessId,
        type: entityType,
        hash: signedHash,
        url: process.env.APP_BASE_URL
            ? `${process.env.APP_BASE_URL}/api/verify/${entityType}/${businessId}`
            : undefined
    });

    const qrPng = await QRCode.toBuffer(qrPayload, { errorCorrectionLevel: 'M', width: 400 });
    const barcodePng = await bwipjs.toBuffer({
        bcid: 'code128',       // barcode type
        text: businessId,      // human-readable business id only, per spec
        scale: 3,
        height: 12,
        includetext: true,
        textxalign: 'center'
    });
    return { qrPng, barcodePng, signedHash };
}

async function generateForEntitySafe(entityType, businessId) {
    try { return await generateForEntity(entityType, businessId); }
    catch (error) {
        console.error(`QR/barcode generation failed for ${entityType} ${businessId}:`, error.message);
        return null;
    }
}

/**
 * Verifies a scanned QR payload against the signature this system issued.
 * Use before accepting any critical action (gate entry, stock movement).
 */
function verifyQrPayload(rawPayload) {
    let parsed;
    try {
        parsed = JSON.parse(rawPayload);
    } catch {
        return { valid: false, reason: 'Payload is not valid JSON' };
    }

    const { id, type, hash } = parsed;
    if (!id || !type || !hash) {
        return { valid: false, reason: 'Payload missing required fields' };
    }

    const expectedHash = signPayload(type, id);
    const hashBuf = Buffer.from(hash, 'hex');
    const expectedBuf = Buffer.from(expectedHash, 'hex');
    // timingSafeEqual throws if lengths differ, which itself means "not valid"
    const valid = hashBuf.length === expectedBuf.length && crypto.timingSafeEqual(hashBuf, expectedBuf);
    return valid
        ? { valid: true, entityType: type, businessId: id }
        : { valid: false, reason: 'Signature does not match - possible forged code' };
}

module.exports = { generateForEntity, generateForEntitySafe, renderForEntity, verifyQrPayload };
