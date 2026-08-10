const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { getEffectivePermissions } = require('../services/permissionService');
const { asyncHandler } = require('./errorHandler');

/**
 * Verifies the JWT on the Authorization header, loads the current user
 * record (so a disabled/deleted account is rejected even with a still-valid
 * token), and attaches req.user + req.permissions for downstream handlers.
 */
async function requireAuthHandler(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: 'Missing bearer token' });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { rows } = await query(
        `SELECT id, username, account_type, status, company_id, linked_customer_id, linked_employee_id, linked_vendor_id
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [decoded.sub]
    );

    const user = rows[0];
    if (!user) {
        return res.status(401).json({ error: 'Account no longer exists' });
    }
    if (user.status !== 'active') {
        return res.status(403).json({ error: `Account is ${user.status}, not active` });
    }

    req.user = user;
    req.permissions = await getEffectivePermissions(user.id);
    next();
}

const requireAuth = asyncHandler(requireAuthHandler);

module.exports = { requireAuth };
