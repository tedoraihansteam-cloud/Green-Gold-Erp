const { query } = require('../config/db');
const { logAction } = require('../services/auditLogger');

async function getMyProfile(req, res) {
    const { rows } = await query(
        `SELECT id, username, email, phone, display_name, profile_photo_url, account_type, preferences, created_at, last_login_at
         FROM users WHERE id = $1 AND deleted_at IS NULL`, [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Profile not found' });
    res.json({ profile: rows[0] });
}

async function updateMyProfile(req, res) {
    const { displayName, email, phone, profilePhotoUrl, preferences } = req.body;
    const normalizedPreferences = preferences && typeof preferences === 'object' ? {
        theme: ['light', 'dark', 'system'].includes(preferences.theme) ? preferences.theme : 'system',
        accent: ['green','emerald','blue','indigo','purple','rose','orange','gold','teal','slate'].includes(preferences.accent) ? preferences.accent : 'green',
        density: ['comfortable', 'compact', 'dense'].includes(preferences.density) ? preferences.density : 'comfortable',
        sidebarMode: ['expanded','collapsed','auto','icon-only'].includes(preferences.sidebarMode) ? preferences.sidebarMode : 'expanded',
        locale: ['en-BD','bn-BD'].includes(preferences.locale) ? preferences.locale : 'en-BD',
        dateFormat: ['DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD'].includes(preferences.dateFormat) ? preferences.dateFormat : 'DD/MM/YYYY',
        timeFormat: ['12-hour','24-hour'].includes(preferences.timeFormat) ? preferences.timeFormat : '12-hour',
        defaultPrintSize: ['A4', 'label'].includes(preferences.defaultPrintSize) ? preferences.defaultPrintSize : 'A4',
        reducedMotion: Boolean(preferences.reducedMotion),
        largerText: Boolean(preferences.largerText),
        highContrast: Boolean(preferences.highContrast),
        menuFavorites: Array.isArray(preferences.menuFavorites) ? preferences.menuFavorites.filter((x) => typeof x === 'string').slice(0, 20) : [],
        defaultDashboard: typeof preferences.defaultDashboard === 'string' ? preferences.defaultDashboard.slice(0, 60) : 'overview',
        dashboardWidgets: Array.isArray(preferences.dashboardWidgets) ? preferences.dashboardWidgets.filter((x) => typeof x === 'string').slice(0, 30) : []
        ,operationalScopeId: typeof preferences.operationalScopeId === 'string' ? preferences.operationalScopeId.slice(0, 80) : ''
        ,operationalScopeName: typeof preferences.operationalScopeName === 'string' ? preferences.operationalScopeName.slice(0, 120) : ''
        ,operationalScopeType: typeof preferences.operationalScopeType === 'string' ? preferences.operationalScopeType.slice(0, 40) : ''
    } : null;
    const { rows } = await query(
        `UPDATE users SET display_name = $1, email = $2, phone = $3, profile_photo_url = $4,
                preferences = CASE WHEN $5::jsonb IS NULL THEN preferences ELSE COALESCE(preferences,'{}'::jsonb) || $5::jsonb END
         WHERE id = $6 RETURNING id, username, email, phone, display_name, profile_photo_url, account_type, preferences`,
        [displayName || null, email || null, phone || null, profilePhotoUrl || null, normalizedPreferences, req.user.id]
    );
    await logAction({ actorUserId: req.user.id, action: 'PROFILE_UPDATED', entityType: 'USER', entityId: req.user.id });
    res.json({ profile: rows[0] });
}

async function listUsers(req, res) {
    const { status } = req.query;
    const { rows } = await query(
        `SELECT u.id, u.username, u.email, u.account_type, u.status, u.created_at, u.last_login_at,
                COALESCE(c.business_id, v.business_id, e.business_id) AS linked_business_id,
                COALESCE(c.name, v.name, e.full_name) AS linked_record_name,
                COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
         FROM users u
         LEFT JOIN master_customers c ON c.id = u.linked_customer_id
         LEFT JOIN master_vendors v ON v.id = u.linked_vendor_id
         LEFT JOIN master_employees e ON e.id = u.linked_employee_id
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE u.company_id = $1 AND u.deleted_at IS NULL
           AND ($2::text IS NULL OR u.status = $2)
         GROUP BY u.id, c.business_id, c.name, v.business_id, v.name, e.business_id, e.full_name
         ORDER BY u.created_at DESC`,
        [req.user.company_id, status || null]
    );
    res.json({ users: rows });
}

async function assignRole(req, res) {
    const { id } = req.params;
    const { roleId } = req.body;
    if (!roleId) return res.status(400).json({ error: 'roleId is required' });

    const { rows } = await query(
        `INSERT INTO user_roles (user_id, role_id)
         SELECT u.id, r.id
         FROM users u
         JOIN roles r ON r.id = $2 AND r.company_id = u.company_id
         WHERE u.id = $1 AND u.company_id = $3
           AND r.allowed_account_types @> ARRAY[u.account_type]::text[]
         ON CONFLICT DO NOTHING
         RETURNING user_id`,
        [id, roleId, req.user.company_id]
    );
    if (!rows.length) {
        return res.status(400).json({ error: 'This role is not available for the selected user account type' });
    }
    await logAction({ actorUserId: req.user.id, action: 'ROLE_ASSIGNED', entityType: 'USER', entityId: id, after: { roleId } });
    res.json({ message: 'Role assigned' });
}

async function removeRole(req, res) {
    const { id, roleId } = req.params;
    await query(`DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`, [id, roleId]);
    await logAction({ actorUserId: req.user.id, action: 'ROLE_REMOVED', entityType: 'USER', entityId: id, after: { roleId } });
    res.json({ message: 'Role removed' });
}

async function disableUser(req, res) {
    const { id } = req.params;
    if (id === req.user.id) {
        return res.status(400).json({ error: "You can't disable your own account" });
    }
    const { rows } = await query(
        `UPDATE users SET status = 'disabled' WHERE id = $1 AND company_id = $2 RETURNING id, username, status`,
        [id, req.user.company_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

    await logAction({ actorUserId: req.user.id, action: 'USER_DISABLED', entityType: 'USER', entityId: id });
    res.json({ message: 'User disabled', user: rows[0] });
}

module.exports = { getMyProfile, updateMyProfile, listUsers, assignRole, removeRole, disableUser };
