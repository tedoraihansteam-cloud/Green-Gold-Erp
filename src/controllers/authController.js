const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query, withTransaction } = require('../config/db');
const { logAction } = require('../services/auditLogger');
const { generateNextId } = require('../services/numberingEngine');

const BCRYPT_ROUNDS = 12;
const MASTER_TABLES = {
    employee: { table: 'master_employees', column: 'linked_employee_id', nameColumn: 'full_name' },
    customer: { table: 'master_customers', column: 'linked_customer_id', nameColumn: 'name' },
    vendor: { table: 'master_vendors', column: 'linked_vendor_id', nameColumn: 'name' }
};

function masterTypeForAccount(accountType) {
    return accountType === 'staff' ? 'employee' : accountType;
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Registration entry point for all account types. A staff member, customer,
 * or vendor can optionally supply their existing business_id (Employee ID /
 * Customer ID / Vendor ID) to request their new login be linked to that
 * permanent master record. Either way, the account starts as
 * 'pending_approval' - nobody can log in until an authorized internal user
 * approves them. Per architecture rule #7, master records and login
 * accounts are always created/approved separately.
 */
async function register(req, res) {
    const { username, email, password, accountType, companyId, masterBusinessId } = req.body;

    if (!username || !password || !companyId) {
        return res.status(400).json({ error: 'username, password, and companyId are required' });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (email && !isValidEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }
    const type = ['staff', 'customer', 'vendor'].includes(accountType) ? accountType : 'staff';
    if (masterBusinessId && type === 'staff' && !MASTER_TABLES.employee) {
        // unreachable guard kept for clarity; real check happens below
    }

    try {
        const result = await withTransaction(async (client) => {
            const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

            const { rows: userRows } = await client.query(
                `INSERT INTO users (company_id, username, email, password_hash, account_type, status)
                 VALUES ($1, $2, $3, $4, $5, 'pending_approval')
                 RETURNING id, username, account_type, status`,
                [companyId, username, email || null, passwordHash, type]
            );
            const user = userRows[0];

            let linkRequest = null;
            if (masterBusinessId) {
                const masterType = type === 'staff' ? 'employee' : type; // staff links to employee master
                const config = MASTER_TABLES[masterType];

                // Confirm the business_id they typed actually exists before
                // creating the request, so admins aren't reviewing junk.
                const { rows: masterRows } = await client.query(
                    `SELECT business_id FROM ${config.table} WHERE business_id = $1 AND deleted_at IS NULL`,
                    [masterBusinessId]
                );
                if (masterRows.length === 0) {
                    throw Object.assign(new Error(`No matching ${masterType} record for ID ${masterBusinessId}`), { statusCode: 404 });
                }

                const { rows: reqRows } = await client.query(
                    `INSERT INTO link_requests (requesting_user_id, master_type, master_business_id, status)
                     VALUES ($1, $2, $3, 'pending')
                     RETURNING id, status`,
                    [user.id, masterType, masterBusinessId]
                );
                linkRequest = reqRows[0];
            }

            return { user, linkRequest };
        });

        await logAction({
            action: 'USER_REGISTERED',
            entityType: 'USER',
            entityId: result.user.id,
            after: { username: result.user.username, accountType: result.user.account_type }
        });

        res.status(201).json({
            message: 'Registration received. An administrator must approve this account before you can log in.',
            user: result.user,
            linkRequest: result.linkRequest
        });
    } catch (err) {
        if (err.code === '23505') { // unique_violation
            return res.status(409).json({ error: 'Username or email is already registered' });
        }
        res.status(err.statusCode || 500).json({ error: err.message || 'Registration failed' });
    }
}

async function login(req, res) {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'username and password are required' });
    }

    const { rows } = await query(
        `SELECT id, username, password_hash, status, account_type FROM users WHERE username = $1 AND deleted_at IS NULL`,
        [username]
    );
    const user = rows[0];

    // Same generic message whether the user doesn't exist or the password
    // is wrong, to avoid leaking which usernames are registered.
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (user.status === 'pending_approval') {
        return res.status(403).json({ error: 'Your account is awaiting administrator approval' });
    }
    if (user.status !== 'active') {
        return res.status(403).json({ error: `Account is ${user.status}` });
    }

    const token = jwt.sign({ sub: user.id, accountType: user.account_type }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '8h'
    });

    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    await logAction({ actorUserId: user.id, action: 'USER_LOGIN', entityType: 'USER', entityId: user.id });

    res.json({ token, user: { id: user.id, username: user.username, accountType: user.account_type } });
}

async function listPendingLinkRequests(req, res) {
    const { rows } = await query(
        `SELECT lr.id, lr.master_type, lr.master_business_id, lr.status, lr.created_at,
                u.username, u.email, u.account_type
         FROM link_requests lr
         JOIN users u ON u.id = lr.requesting_user_id
         WHERE lr.status = 'pending'
         ORDER BY lr.created_at ASC`
    );
    res.json({ linkRequests: rows });
}

async function listPendingApprovals(req,res){
    const {rows}=await query(`SELECT u.id,u.username,u.email,u.account_type,u.created_at,
        lr.id AS link_request_id,lr.master_type,lr.master_business_id,
        CASE WHEN lr.id IS NULL THEN 'account' ELSE 'link' END AS approval_kind
        FROM users u LEFT JOIN link_requests lr ON lr.requesting_user_id=u.id AND lr.status='pending'
        WHERE u.company_id=$1 AND u.status='pending_approval' ORDER BY u.created_at`,[req.user.company_id]);
    res.json({approvals:rows});
}

async function listApprovalLinkOptions(req, res) {
    const { rows: userRows } = await query(
        `SELECT id, company_id, account_type
         FROM users
         WHERE id=$1 AND company_id=$2 AND status='pending_approval' AND deleted_at IS NULL`,
        [req.params.userId, req.user.company_id]
    );
    const pendingUser = userRows[0];
    if (!pendingUser) return res.status(404).json({ error: 'Pending account not found' });

    const masterType = masterTypeForAccount(pendingUser.account_type);
    const config = MASTER_TABLES[masterType];
    const [{ rows: records }, { rows: roles }, { rows: requestedLinks }] = await Promise.all([
        query(
            `SELECT m.business_id, m.${config.nameColumn} AS name, m.phone, m.email, m.status,
                    linked.username AS linked_username
             FROM ${config.table} m
             LEFT JOIN users linked
               ON linked.${config.column}=m.id
              AND linked.id<>$2
              AND linked.deleted_at IS NULL
             WHERE m.company_id=$1 AND m.deleted_at IS NULL
             ORDER BY m.${config.nameColumn}, m.business_id`,
            [req.user.company_id, pendingUser.id]
        ),
        query(
            `SELECT id, name, description
             FROM roles
             WHERE company_id=$1 AND allowed_account_types @> ARRAY[$2]::text[]
             ORDER BY name`,
            [req.user.company_id, pendingUser.account_type]
        ),
        query(
            `SELECT master_business_id
             FROM link_requests
             WHERE requesting_user_id=$1 AND status='pending'
             ORDER BY created_at DESC LIMIT 1`,
            [pendingUser.id]
        ),
    ]);

    res.json({
        accountType: pendingUser.account_type,
        masterType,
        records,
        roles,
        suggestedBusinessId: requestedLinks[0]?.master_business_id || null,
        linkRequired: ['customer', 'vendor'].includes(pendingUser.account_type),
    });
}

async function reviewPendingApproval(req,res){
    const { decision, notes, masterBusinessId, roleIds = [] } = req.body;
    if (!['approve', 'reject'].includes(decision)) {
        return res.status(400).json({ error: 'decision must be approve or reject' });
    }
    if (!Array.isArray(roleIds)) return res.status(400).json({ error: 'roleIds must be an array' });

    const result = await withTransaction(async (client) => {
        const { rows: userRows } = await client.query(
            `SELECT * FROM users
             WHERE id=$1 AND company_id=$2 AND status='pending_approval' AND deleted_at IS NULL
             FOR UPDATE`,
            [req.params.userId, req.user.company_id]
        );
        const pendingUser = userRows[0];
        if (!pendingUser) {
            throw Object.assign(new Error('Pending account not found'), { statusCode: 404 });
        }

        const { rows: pendingLinks } = await client.query(
            `SELECT * FROM link_requests
             WHERE requesting_user_id=$1 AND status='pending'
             ORDER BY created_at DESC FOR UPDATE`,
            [pendingUser.id]
        );

        if (decision === 'reject') {
            await client.query(
                `UPDATE link_requests
                 SET status='rejected',reviewed_by=$1,reviewed_at=now(),review_notes=$2
                 WHERE requesting_user_id=$3 AND status='pending'`,
                [req.user.id, notes || null, pendingUser.id]
            );
            await client.query(
                `UPDATE users SET status='rejected',approved_by=$1,approved_at=now() WHERE id=$2`,
                [req.user.id, pendingUser.id]
            );
            return { decision, user: pendingUser, masterBusinessId: null, roleIds: [] };
        }

        const masterType = masterTypeForAccount(pendingUser.account_type);
        const config = MASTER_TABLES[masterType];
        const selectedBusinessId = masterBusinessId || pendingLinks[0]?.master_business_id || null;
        if (['customer', 'vendor'].includes(pendingUser.account_type) && !selectedBusinessId) {
            throw Object.assign(new Error(`Select an existing ${masterType} record before approval`), { statusCode: 400 });
        }

        let masterRecord = null;
        if (selectedBusinessId) {
            const { rows: masterRows } = await client.query(
                `SELECT id, business_id FROM ${config.table}
                 WHERE business_id=$1 AND company_id=$2 AND deleted_at IS NULL`,
                [selectedBusinessId, req.user.company_id]
            );
            masterRecord = masterRows[0];
            if (!masterRecord) {
                throw Object.assign(new Error(`Selected ${masterType} record was not found`), { statusCode: 404 });
            }

            const { rows: linkedRows } = await client.query(
                `SELECT username FROM users
                 WHERE ${config.column}=$1 AND id<>$2 AND deleted_at IS NULL LIMIT 1`,
                [masterRecord.id, pendingUser.id]
            );
            if (linkedRows.length) {
                throw Object.assign(new Error(`This ${masterType} record is already linked to ${linkedRows[0].username}`), { statusCode: 409 });
            }
        }

        const uniqueRoleIds = [...new Set(roleIds.filter(Boolean))];
        if (uniqueRoleIds.length) {
            const { rows: validRoles } = await client.query(
                `SELECT id FROM roles
                 WHERE company_id=$1 AND id=ANY($2::uuid[])
                   AND allowed_account_types @> ARRAY[$3]::text[]`,
                [req.user.company_id, uniqueRoleIds, pendingUser.account_type]
            );
            if (validRoles.length !== uniqueRoleIds.length) {
                throw Object.assign(new Error('One or more selected roles are not available for this account type'), { statusCode: 400 });
            }
        }

        if (masterRecord) {
            const otherLinkColumns = ['linked_employee_id', 'linked_customer_id', 'linked_vendor_id']
                .filter((column) => column !== config.column);
            await client.query(
                `UPDATE users
                 SET status='active',approved_by=$1,approved_at=now(),
                     ${otherLinkColumns.map((column) => `${column}=NULL`).join(',')},
                     ${config.column}=$2
                 WHERE id=$3`,
                [req.user.id, masterRecord.id, pendingUser.id]
            );
            if (pendingLinks.length) {
                await client.query(
                    `UPDATE link_requests
                     SET master_type=$1,master_business_id=$2,status='approved',
                         reviewed_by=$3,reviewed_at=now(),review_notes=$4
                     WHERE requesting_user_id=$5 AND status='pending'`,
                    [masterType, masterRecord.business_id, req.user.id, notes || null, pendingUser.id]
                );
            } else {
                await client.query(
                    `INSERT INTO link_requests(
                       requesting_user_id,master_type,master_business_id,status,
                       reviewed_by,reviewed_at,review_notes
                     ) VALUES($1,$2,$3,'approved',$4,now(),$5)`,
                    [pendingUser.id, masterType, masterRecord.business_id, req.user.id, notes || null]
                );
            }
        } else {
            await client.query(
                `UPDATE users SET status='active',approved_by=$1,approved_at=now() WHERE id=$2`,
                [req.user.id, pendingUser.id]
            );
        }

        for (const roleId of uniqueRoleIds) {
            await client.query(
                `INSERT INTO user_roles(user_id,role_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
                [pendingUser.id, roleId]
            );
        }

        return {
            decision,
            user: pendingUser,
            masterBusinessId: masterRecord?.business_id || null,
            roleIds: uniqueRoleIds,
        };
    });

    await logAction({
        actorUserId: req.user.id,
        action: result.decision === 'approve' ? 'USER_APPROVED_AND_LINKED' : 'USER_REJECTED',
        entityType: 'USER',
        entityId: req.params.userId,
        after: { masterBusinessId: result.masterBusinessId, roleIds: result.roleIds, notes },
    });
    return res.json({
        message: result.decision === 'approve' ? 'Account linked and activated' : 'Account rejected',
        masterBusinessId: result.masterBusinessId,
        roleIds: result.roleIds,
    });
}

async function reviewLinkRequest(req, res) {
    const { id } = req.params;
    const { decision, notes } = req.body; // decision: 'approve' | 'reject'

    if (!['approve', 'reject'].includes(decision)) {
        return res.status(400).json({ error: "decision must be 'approve' or 'reject'" });
    }

    try {
        const result = await withTransaction(async (client) => {
            const { rows } = await client.query(
                `SELECT * FROM link_requests WHERE id = $1 AND status = 'pending' FOR UPDATE`,
                [id]
            );
            const linkRequest = rows[0];
            if (!linkRequest) {
                throw Object.assign(new Error('Link request not found or already reviewed'), { statusCode: 404 });
            }

            await client.query(
                `UPDATE link_requests SET status = $1, reviewed_by = $2, reviewed_at = now(), review_notes = $3 WHERE id = $4`,
                [decision === 'approve' ? 'approved' : 'rejected', req.user.id, notes || null, id]
            );

            if (decision === 'approve') {
                const config = MASTER_TABLES[linkRequest.master_type];
                const { rows: masterRows } = await client.query(
                    `SELECT id FROM ${config.table} WHERE business_id = $1`,
                    [linkRequest.master_business_id]
                );
                if (masterRows.length === 0) {
                    throw Object.assign(new Error('Master record no longer exists'), { statusCode: 409 });
                }

                await client.query(
                    `UPDATE users SET status = 'active', ${config.column} = $1, approved_by = $2, approved_at = now()
                     WHERE id = $3`,
                    [masterRows[0].id, req.user.id, linkRequest.requesting_user_id]
                );
            }

            return linkRequest;
        });

        await logAction({
            actorUserId: req.user.id,
            action: decision === 'approve' ? 'LINK_REQUEST_APPROVED' : 'LINK_REQUEST_REJECTED',
            entityType: 'LINK_REQUEST',
            entityId: id,
            after: { masterType: result.master_type, masterBusinessId: result.master_business_id, notes }
        });

        res.json({ message: `Link request ${decision}d` });
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message || 'Review failed' });
    }
}

/**
 * Approve a staff/customer/vendor account that registered WITHOUT a
 * master-record link (e.g. a brand-new customer with no prior Customer ID).
 * Admin can optionally create the master record at the same time - left as
 * a follow-up wiring point for the customer/vendor management module.
 */
async function activateAccountDirectly(req, res) {
    const { id } = req.params;
    const { rows } = await query(
        `UPDATE users SET status = 'active', approved_by = $1, approved_at = now()
         WHERE id = $2 AND status = 'pending_approval'
         RETURNING id, username, account_type`,
        [req.user.id, id]
    );
    if (rows.length === 0) {
        return res.status(404).json({ error: 'User not found or not pending approval' });
    }

    await logAction({ actorUserId: req.user.id, action: 'USER_APPROVED', entityType: 'USER', entityId: id });
    res.json({ message: 'Account activated', user: rows[0] });
}

async function changePassword(req, res) {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const { rows } = await query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
    const valid = rows[0] && (await bcrypt.compare(currentPassword, rows[0].password_hash));
    if (!valid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, req.user.id]);
    await logAction({ actorUserId: req.user.id, action: 'PASSWORD_CHANGED', entityType: 'USER', entityId: req.user.id });

    res.json({ message: 'Password updated' });
}

async function me(req, res) {
    const { rows } = await query(
        `SELECT u.id, u.username, u.email, u.account_type, u.company_id,
                COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE u.id = $1 GROUP BY u.id`,
        [req.user.id]
    );
    res.json({ user: rows[0], permissions: Array.from(req.permissions) });
}

async function requestPasswordReset(req,res){const identifier=String(req.body.identifier||'').trim(),reason=String(req.body.reason||'Forgot password').trim();if(!identifier)return res.status(400).json({error:'Username, email, or phone is required'});const user=(await query(`SELECT u.id,u.company_id FROM users u LEFT JOIN master_employees e ON e.id=u.linked_employee_id LEFT JOIN master_customers c ON c.id=u.linked_customer_id LEFT JOIN master_vendors v ON v.id=u.linked_vendor_id WHERE u.deleted_at IS NULL AND u.status='active' AND (lower(u.username)=lower($1) OR lower(COALESCE(u.email,''))=lower($1) OR e.phone=$1 OR c.phone=$1 OR v.phone=$1) LIMIT 1`,[identifier])).rows[0];if(user){const pending=(await query(`SELECT id FROM password_reset_requests WHERE user_id=$1 AND status='submitted'`,[user.id])).rows[0];if(!pending){const businessId=await generateNextId('PASSWORD_RESET');await query(`INSERT INTO password_reset_requests(business_id,company_id,user_id,identifier,reason) VALUES($1,$2,$3,$4,$5)`,[businessId,user.company_id,user.id,identifier,reason]);await logAction({action:'PASSWORD_RESET_REQUESTED',entityType:'USER',entityId:user.id,after:{businessId}});}}res.json({message:'If the account exists, a password reset request has been sent to an authorized administrator.'});}
async function listPasswordResets(req,res){const {rows}=await query(`SELECT prr.*,u.username,u.email,COALESCE(e.full_name,c.name,v.name,u.username) display_name,rv.username reviewer_username FROM password_reset_requests prr JOIN users u ON u.id=prr.user_id LEFT JOIN master_employees e ON e.id=u.linked_employee_id LEFT JOIN master_customers c ON c.id=u.linked_customer_id LEFT JOIN master_vendors v ON v.id=u.linked_vendor_id LEFT JOIN users rv ON rv.id=prr.reviewed_by WHERE prr.company_id=$1 ORDER BY prr.requested_at DESC`,[req.user.company_id]);res.json({requests:rows});}
async function reviewPasswordReset(req,res){const decision=String(req.body.decision||'').toLowerCase(),notes=String(req.body.notes||'').trim();if(!['approve','reject'].includes(decision)||!notes)return res.status(400).json({error:'Decision and verification notes are required'});const result=await withTransaction(async client=>{const request=(await client.query(`SELECT * FROM password_reset_requests WHERE business_id=$1 AND company_id=$2 AND status='submitted' FOR UPDATE`,[req.params.businessId,req.user.company_id])).rows[0];if(!request)throw Object.assign(new Error('Reset request is not pending'),{statusCode:409});if(decision==='reject')return {request:(await client.query(`UPDATE password_reset_requests SET status='rejected',reviewed_by=$1,reviewed_at=now(),review_notes=$2 WHERE id=$3 RETURNING *`,[req.user.id,notes,request.id])).rows[0]};const temporaryPassword=`Gg-${require('crypto').randomBytes(6).toString('base64url')}!`;const hash=await bcrypt.hash(temporaryPassword,BCRYPT_ROUNDS);await client.query(`UPDATE users SET password_hash=$1,must_change_password=true WHERE id=$2`,[hash,request.user_id]);const updated=(await client.query(`UPDATE password_reset_requests SET status='completed',reviewed_by=$1,reviewed_at=now(),review_notes=$2,completed_at=now() WHERE id=$3 RETURNING *`,[req.user.id,notes,request.id])).rows[0];return {request:updated,temporaryPassword};});await logAction({actorUserId:req.user.id,action:`PASSWORD_RESET_${decision.toUpperCase()}`,entityType:'USER',entityId:result.request.user_id,after:{request:result.request.business_id}});res.json(result);}

module.exports = { register, login, listPendingLinkRequests, listPendingApprovals, listApprovalLinkOptions, reviewPendingApproval, reviewLinkRequest, activateAccountDirectly, changePassword, me,requestPasswordReset,listPasswordResets,reviewPasswordReset };
