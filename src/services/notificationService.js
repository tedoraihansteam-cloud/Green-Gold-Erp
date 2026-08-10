const { query } = require('../config/db');

/**
 * Green Gold ERP intentionally has no chat/messaging system (architecture
 * rule #16). This is the one-way notice board: management posts notices,
 * targeted at everyone or a specific branch/department/role/user/account
 * type, and the system tracks who has read or acknowledged each one.
 */

async function createNotice({ title, body, createdBy, targetType = 'all', targetValue = null, sendEmail = false, sendPush = true, sendSms = false, expiresAt = null }) {
    const { rows } = await query(
        `INSERT INTO notices (title, body, created_by, target_type, target_value, send_email, send_push, send_sms, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [title, body, createdBy, targetType, targetValue, sendEmail, sendPush, sendSms, expiresAt]
    );
    // Actual email/push/SMS dispatch is a separate integration (rule #17,
    // integration hub) - left as a follow-up wiring point so this service
    // doesn't hard-code a specific provider.
    return rows[0];
}

async function getUserContext(userId) {
    const { rows: userRows } = await query(
        `SELECT company_id, branch_id, department_id, account_type FROM users WHERE id = $1`,
        [userId]
    );
    const { rows: roleRows } = await query(
        `SELECT role_id FROM user_roles WHERE user_id = $1`,
        [userId]
    );
    const user = userRows[0] || {};
    return {
        companyId: user.company_id,
        branchId: user.branch_id,
        departmentId: user.department_id,
        accountType: user.account_type,
        roleIds: roleRows.map((r) => r.role_id)
    };
}

async function getNoticesForUser(userId) {
    const ctx = await getUserContext(userId);

    const { rows } = await query(
        `SELECT n.*, nr.read_at, nr.acknowledged_at
         FROM notices n
         JOIN users creator ON creator.id=n.created_by AND creator.company_id=$6
         LEFT JOIN notice_reads nr ON nr.notice_id = n.id AND nr.user_id = $1
         WHERE (n.expires_at IS NULL OR n.expires_at > now())
           AND (
             n.target_type = 'all'
             OR (n.target_type = 'branch' AND n.target_value = $2)
             OR (n.target_type = 'department' AND n.target_value = $3)
             OR (n.target_type = 'user' AND n.target_value = $1::text)
             OR (n.target_type = 'role' AND n.target_value = ANY($4::text[]))
             OR (n.target_type = $5)
           )
         ORDER BY n.created_at DESC`,
        [userId, ctx.branchId, ctx.departmentId, ctx.roleIds, ctx.accountType, ctx.companyId]
    );
    return rows;
}

async function markRead(noticeId, userId) {
    await query(
        `INSERT INTO notice_reads (notice_id, user_id, read_at)
         VALUES ($1, $2, now())
         ON CONFLICT (notice_id, user_id) DO UPDATE SET read_at = now()`,
        [noticeId, userId]
    );
}

async function acknowledge(noticeId, userId) {
    await query(
        `INSERT INTO notice_reads (notice_id, user_id, read_at, acknowledged_at)
         VALUES ($1, $2, now(), now())
         ON CONFLICT (notice_id, user_id) DO UPDATE SET acknowledged_at = now(), read_at = COALESCE(notice_reads.read_at, now())`,
        [noticeId, userId]
    );
}

module.exports = { createNotice, getNoticesForUser, markRead, acknowledge };
