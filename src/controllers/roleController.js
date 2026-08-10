const { query, withTransaction } = require('../config/db');
const { logAction } = require('../services/auditLogger');

const ACCOUNT_TYPES = new Set(['staff', 'customer', 'vendor']);

function normalizeAccountTypes(value) {
    const accountTypes = Array.isArray(value) ? [...new Set(value)] : ['staff'];
    if (accountTypes.length === 0 || accountTypes.some((type) => !ACCOUNT_TYPES.has(type))) {
        throw Object.assign(new Error('Select at least one valid account type: staff, customer, or vendor'), { statusCode: 400 });
    }
    return accountTypes;
}

async function listPermissions(req, res) {
    const { rows } = await query(
        `SELECT p.id, p.code, p.name, m.code AS module_code, m.name AS module_name
         FROM permissions p JOIN modules m ON m.id = p.module_id
         ORDER BY m.code, p.code`
    );

    // Grouped by module so the UI can render a checklist per module
    // instead of one giant flat list.
    const grouped = {};
    for (const p of rows) {
        if (!grouped[p.module_code]) grouped[p.module_code] = { moduleName: p.module_name, permissions: [] };
        grouped[p.module_code].permissions.push({ id: p.id, code: p.code, name: p.name });
    }
    res.json({ modules: grouped });
}

async function createRole(req, res) {
    const { name, description, allowedAccountTypes } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const accountTypes = normalizeAccountTypes(allowedAccountTypes);

    try {
        const { rows } = await query(
            `INSERT INTO roles (company_id, name, description, allowed_account_types)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [req.user.company_id, name, description || null, accountTypes]
        );
        await logAction({ actorUserId: req.user.id, action: 'ROLE_CREATED', entityType: 'ROLE', entityId: rows[0].id, after: rows[0] });
        res.status(201).json({ role: rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'A role with this name already exists' });
        throw err;
    }
}

async function listRoles(req, res) {
    const { rows } = await query(
        `SELECT r.id, r.name, r.description, r.is_system_role, r.allowed_account_types,
                COALESCE(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permission_codes
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
         WHERE r.company_id = $1
         GROUP BY r.id
         ORDER BY r.name`,
        [req.user.company_id]
    );
    res.json({ roles: rows });
}

/**
 * Replaces a role's entire permission set with the given list of
 * permission codes. Sending an empty array clears all permissions for
 * that role (e.g. temporarily suspending its access) rather than being
 * rejected, since that's a legitimate admin action.
 */
async function setRolePermissions(req, res) {
    const { id } = req.params;
    const { permissionCodes, allowedAccountTypes } = req.body;
    if (!Array.isArray(permissionCodes)) {
        return res.status(400).json({ error: 'permissionCodes must be an array of permission code strings' });
    }

    const accountTypes = normalizeAccountTypes(allowedAccountTypes);
    const result = await withTransaction(async (client) => {
        const { rows: roleRows } = await client.query(
            `SELECT * FROM roles WHERE id = $1 AND company_id = $2`,
            [id, req.user.company_id]
        );
        if (roleRows.length === 0) {
            throw Object.assign(new Error('Role not found'), { statusCode: 404 });
        }
        if (roleRows[0].is_system_role) {
            throw Object.assign(new Error('System roles (e.g. Super Admin) cannot be edited'), { statusCode: 403 });
        }

        await client.query(
            `UPDATE roles SET allowed_account_types = $1 WHERE id = $2`,
            [accountTypes, id]
        );
        await client.query(
            `DELETE FROM user_roles ur
             USING users u
             WHERE ur.role_id=$1 AND u.id=ur.user_id
               AND NOT ($2::text[] @> ARRAY[u.account_type]::text[])`,
            [id, accountTypes]
        );

        await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [id]);

        if (permissionCodes.length > 0) {
            const { rows: permRows } = await client.query(
                `SELECT id, code FROM permissions WHERE code = ANY($1::text[])`,
                [permissionCodes]
            );
            const foundCodes = new Set(permRows.map((p) => p.code));
            const unknown = permissionCodes.filter((c) => !foundCodes.has(c));
            if (unknown.length > 0) {
                throw Object.assign(new Error(`Unknown permission codes: ${unknown.join(', ')}`), { statusCode: 400 });
            }
            for (const p of permRows) {
                await client.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`, [id, p.id]);
            }
        }

        return { roleId: id, permissionCodes, allowedAccountTypes: accountTypes };
    });

    await logAction({ actorUserId: req.user.id, action: 'ROLE_PERMISSIONS_UPDATED', entityType: 'ROLE', entityId: id, after: result });
    res.json({ message: 'Role permissions updated', ...result });
}

module.exports = { listPermissions, createRole, listRoles, setRolePermissions };
