const { query } = require('../config/db');

/**
 * Resolves the effective set of permission codes for a user:
 * (union of all permissions granted by their roles) then applies
 * per-user overrides on top (explicit grant/deny wins over role default).
 */
async function getEffectivePermissions(userId) {
    const { rows: rolePerms } = await query(
        `SELECT DISTINCT p.code
         FROM user_roles ur
         JOIN users u ON u.id = ur.user_id
         JOIN roles r ON r.id = ur.role_id
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = $1
           AND r.allowed_account_types @> ARRAY[u.account_type]::text[]`,
        [userId]
    );

    const { rows: overrides } = await query(
        `SELECT p.code, upo.granted
         FROM user_permission_overrides upo
         JOIN permissions p ON p.id = upo.permission_id
         WHERE upo.user_id = $1`,
        [userId]
    );

    const effective = new Set(rolePerms.map((r) => r.code));
    for (const { code, granted } of overrides) {
        if (granted) effective.add(code);
        else effective.delete(code);
    }

    return effective;
}

module.exports = { getEffectivePermissions };
