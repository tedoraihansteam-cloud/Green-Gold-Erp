const { verifyQrPayload } = require('../services/qrBarcodeService');
const { logAction } = require('../services/auditLogger');

/**
 * Called when a gate/security scanner reads a QR code, before any critical
 * action (gate entry, stock movement) is allowed to proceed. Every scan
 * attempt is audit logged, including failed/forged ones, since a forged
 * code being presented is itself a security-relevant event.
 */
async function verify(req, res) {
    const { payload } = req.body;
    if (!payload) {
        return res.status(400).json({ error: 'payload is required' });
    }

    const result = verifyQrPayload(payload);

    await logAction({
        actorUserId: req.user.id,
        action: result.valid ? 'QR_SCAN_VALID' : 'QR_SCAN_INVALID',
        entityType: result.entityType || 'UNKNOWN',
        entityId: result.businessId || null,
        after: result
    });

    if (!result.valid) {
        return res.status(422).json(result);
    }
    res.json(result);
}

module.exports = { verify };
