/**
 * Route guard factory. Use after requireAuth:
 *
 *   router.post('/invoices', requireAuth, requirePermission('SALES_CREATE'), handler)
 *
 * requireAnyOf lets a route accept multiple acceptable permissions
 * (e.g. an action available to either an owner-level or approver-level role).
 */
function requirePermission(permissionCode) {
    return (req, res, next) => {
        if (!req.permissions || !req.permissions.has(permissionCode)) {
            return res.status(403).json({ error: `Missing required permission: ${permissionCode}` });
        }
        next();
    };
}

function requireAnyOf(permissionCodes) {
    return (req, res, next) => {
        const hasOne = req.permissions && permissionCodes.some((code) => req.permissions.has(code));
        if (!hasOne) {
            return res.status(403).json({ error: `Missing one of required permissions: ${permissionCodes.join(', ')}` });
        }
        next();
    };
}

module.exports = { requirePermission, requireAnyOf };
