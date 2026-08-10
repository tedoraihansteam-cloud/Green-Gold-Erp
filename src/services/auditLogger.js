const { query } = require('../config/db');

/**
 * Records an audit log entry. Application code should never UPDATE or
 * DELETE rows in audit_logs - it is meant to be append-only.
 *
 * @param {object} entry
 * @param {string|null} entry.actorUserId - who performed the action (null for system actions)
 * @param {string} entry.action - e.g. 'USER_APPROVED', 'INVOICE_CREATED'
 * @param {string} entry.entityType - e.g. 'USER', 'INVOICE'
 * @param {string} [entry.entityId]
 * @param {object} [entry.before]
 * @param {object} [entry.after]
 * @param {string} [entry.ipAddress]
 */
async function logAction({ actorUserId = null, action, entityType, entityId = null, before = null, after = null, ipAddress = null }) {
    await query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_data, after_data, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [actorUserId, action, entityType, entityId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, ipAddress]
    );
}

/**
 * Express middleware helper: pulls actor + IP off the request automatically.
 */
function auditFromRequest(req) {
    return (partialEntry) =>
        logAction({
            actorUserId: req.user ? req.user.id : null,
            ipAddress: req.ip,
            ...partialEntry
        });
}

module.exports = { logAction, auditFromRequest };
