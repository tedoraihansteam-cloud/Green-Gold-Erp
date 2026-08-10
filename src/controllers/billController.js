const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { logAction } = require('../services/auditLogger');
const { recordAccountTransaction } = require('./accountController');
const { generateForEntitySafe } = require('../services/qrBarcodeService');

async function event(client, bill, action, fromStatus, toStatus, notes, actorId) {
    await client.query(`INSERT INTO bill_workflow_events(bill_id,action,from_status,to_status,notes,actor_user_id) VALUES($1,$2,$3,$4,$5,$6)`, [bill.id, action, fromStatus, toStatus, notes || null, actorId]);
}
async function signoff(client, companyId, entityType, entityId, role, userId, externalName = null, notes = null) {
    await client.query(`INSERT INTO document_signoffs(company_id,entity_type,entity_id,signoff_role,user_id,external_name,status,signed_at,notes) VALUES($1,$2,$3,$4,$5,$6,'signed',now(),$7) ON CONFLICT(entity_type,entity_id,signoff_role) DO UPDATE SET user_id=EXCLUDED.user_id,external_name=EXCLUDED.external_name,status='signed',signed_at=now(),notes=EXCLUDED.notes`, [companyId, entityType, entityId, role, userId || null, externalName || null, notes || null]);
}
async function createVoucher(client, { companyId, documentType, accountId = null, vendorId = null, sourceId, amount, description, createdBy }) {
    const businessId = await generateNextId(documentType);
    await client.query(`INSERT INTO financial_documents(business_id,company_id,document_type,account_id,vendor_id,source_type,source_id,amount,description,created_by) VALUES($1,$2,$3,$4,$5,'BILL_SUBMISSION',$6,$7,$8,$9)`, [businessId, companyId, documentType, accountId, vendorId, sourceId, amount, description, createdBy]);
    return businessId;
}

async function list(req, res) {
    const reviewer = req.permissions.has('ACCOUNTS_VIEW');
    const { rows } = await query(`SELECT bs.*,u.username AS submitter_username,u.display_name AS submitter_name,v.business_id vendor_business_id,v.name vendor_name,e.business_id employee_business_id,e.full_name employee_name,(SELECT count(*) FROM file_attachments fa WHERE fa.entity_type='BILL_SUBMISSION' AND fa.entity_id=bs.business_id) attachment_count,a.business_id paid_account_business_id FROM bill_submissions bs JOIN users u ON u.id=bs.submitter_user_id LEFT JOIN master_vendors v ON v.id=bs.vendor_id LEFT JOIN master_employees e ON e.id=bs.employee_id LEFT JOIN accounts a ON a.id=bs.paid_account_id WHERE bs.company_id=$1 AND ($2::boolean OR bs.submitter_user_id=$3 OR bs.claimant_user_id=$3) ORDER BY bs.created_at DESC`, [req.user.company_id, reviewer, req.user.id]);
    res.json({ bills: rows, reviewer });
}

async function get(req, res) {
    const reviewer = req.permissions.has('ACCOUNTS_VIEW');
    const { rows } = await query(`SELECT bs.*,u.username AS submitter_username,u.display_name AS submitter_name,ru.username AS reviewer_username,pu.username AS paid_by_username,v.business_id vendor_business_id,v.name vendor_name,e.business_id employee_business_id,e.full_name employee_name,d.name department_name,b.name branch_name,a.business_id paid_account_business_id,a.name paid_account_name FROM bill_submissions bs JOIN users u ON u.id=bs.submitter_user_id LEFT JOIN users ru ON ru.id=bs.reviewed_by LEFT JOIN users pu ON pu.id=bs.paid_by LEFT JOIN master_vendors v ON v.id=bs.vendor_id LEFT JOIN master_employees e ON e.id=bs.employee_id LEFT JOIN departments d ON d.id=bs.department_id LEFT JOIN branches b ON b.id=bs.branch_id LEFT JOIN accounts a ON a.id=bs.paid_account_id WHERE bs.business_id=$1 AND bs.company_id=$2 AND ($3::boolean OR bs.submitter_user_id=$4 OR bs.claimant_user_id=$4)`, [req.params.businessId, req.user.company_id, reviewer, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Bill submission not found' });
    const bill = rows[0];
    const [attachments, history, vouchers, signoffs] = await Promise.all([
        query(`SELECT id,original_name,file_type,file_size_bytes,description,created_at FROM file_attachments WHERE entity_type='BILL_SUBMISSION' AND entity_id=$1 ORDER BY created_at`, [bill.business_id]),
        query(`SELECT e.*,u.username,u.display_name FROM bill_workflow_events e JOIN users u ON u.id=e.actor_user_id WHERE e.bill_id=$1 ORDER BY e.created_at`, [bill.id]),
        query(`SELECT business_id,document_type,amount,description,created_at FROM financial_documents WHERE source_type='BILL_SUBMISSION' AND source_id=$1 ORDER BY created_at`, [bill.business_id]),
        query(`SELECT ds.*,u.username,u.display_name FROM document_signoffs ds LEFT JOIN users u ON u.id=ds.user_id WHERE ds.company_id=$1 AND (ds.entity_id=$2 OR ds.entity_id=ANY($3::text[])) ORDER BY ds.signed_at`, [req.user.company_id, bill.business_id, [bill.approved_voucher_business_id, bill.payment_voucher_business_id, bill.acceptance_voucher_business_id].filter(Boolean)])
    ]);
    res.json({ bill, attachments: attachments.rows, history: history.rows, vouchers: vouchers.rows, signoffs: signoffs.rows, reviewer });
}

async function create(req, res) {
    const { vendorBusinessId, employeeBusinessId, claimantType, claimantUserId, billNumber, billDate, category, payee, amount, description, relatedType, relatedId, departmentId, branchId, expenseStartDate, expenseEndDate, preferredPaymentMethod, expenseBreakdown } = req.body;
    if (!category || !payee || !amount || Number(amount) <= 0) return res.status(400).json({ error: 'category, payee and positive amount are required' });
    let vendorId = null, employeeId = null;
    if (vendorBusinessId) { const r = await query(`SELECT id FROM master_vendors WHERE business_id=$1 AND company_id=$2`, [vendorBusinessId, req.user.company_id]); if (!r.rows.length) return res.status(404).json({ error: 'Vendor not found' }); vendorId = r.rows[0].id; }
    if (employeeBusinessId) { const r = await query(`SELECT id FROM master_employees WHERE business_id=$1 AND company_id=$2`, [employeeBusinessId, req.user.company_id]); if (!r.rows.length) return res.status(404).json({ error: 'Employee not found' }); employeeId = r.rows[0].id; }
    const businessId = await generateNextId('BILL_SUBMISSION');
    const { rows } = await query(`INSERT INTO bill_submissions(business_id,company_id,submitter_user_id,vendor_id,employee_id,claimant_type,claimant_user_id,bill_number,bill_date,category,payee,amount,description,related_type,related_id,department_id,branch_id,expense_start_date,expense_end_date,preferred_payment_method,expense_breakdown) VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::date,CURRENT_DATE),$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb) RETURNING *`, [businessId, req.user.company_id, req.user.id, vendorId, employeeId, claimantType || (vendorId ? 'vendor' : employeeId ? 'employee' : 'external'), claimantUserId || null, billNumber || null, billDate || null, category, payee, amount, description || null, relatedType || null, relatedId || null, departmentId || null, branchId || null, expenseStartDate || null, expenseEndDate || null, preferredPaymentMethod || null, JSON.stringify(Array.isArray(expenseBreakdown) ? expenseBreakdown : [])]);
    await generateForEntitySafe('BILL_SUBMISSION', businessId);
    await logAction({ actorUserId: req.user.id, action: 'BILL_DRAFT_CREATED', entityType: 'BILL_SUBMISSION', entityId: businessId });
    res.status(201).json({ bill: rows[0] });
}

async function update(req, res) {
    const { billNumber, billDate, category, payee, amount, description, expenseStartDate, expenseEndDate, preferredPaymentMethod, expenseBreakdown } = req.body;
    if (!category || !payee || !amount || Number(amount) <= 0) return res.status(400).json({ error: 'category, payee and positive amount are required' });
    const { rows } = await query(`UPDATE bill_submissions SET bill_number=$1,bill_date=COALESCE($2::date,bill_date),category=$3,payee=$4,amount=$5,description=$6,expense_start_date=$7,expense_end_date=$8,preferred_payment_method=$9,expense_breakdown=$10::jsonb WHERE business_id=$11 AND company_id=$12 AND submitter_user_id=$13 AND status IN('draft','returned') RETURNING *`, [billNumber || null, billDate || null, category, payee, amount, description || null, expenseStartDate || null, expenseEndDate || null, preferredPaymentMethod || null, JSON.stringify(Array.isArray(expenseBreakdown) ? expenseBreakdown : []), req.params.businessId, req.user.company_id, req.user.id]);
    if (!rows.length) return res.status(409).json({ error: 'Only your draft or returned claim can be corrected' });
    await logAction({ actorUserId: req.user.id, action: 'BILL_CLAIM_UPDATED', entityType: 'BILL_SUBMISSION', entityId: req.params.businessId });
    res.json({ bill: rows[0] });
}

async function billWorkflow(companyId) { const { rows } = await query(`SELECT * FROM workflow_definitions WHERE company_id=$1 AND workflow_key='bill_submission'`, [companyId]); return rows[0] || { enabled: true, require_attachment: true, approval_steps: [{ permission: 'ACCOUNTS_APPROVE', allowReject: true }] }; }

async function submit(req, res) {
    const workflow = await billWorkflow(req.user.company_id);
    if (!workflow.enabled) return res.status(409).json({ error: 'Bill submission workflow is currently disabled' });
    const result = await withTransaction(async (client) => {
        const { rows } = await client.query(`SELECT * FROM bill_submissions WHERE business_id=$1 AND company_id=$2 AND submitter_user_id=$3 AND status IN('draft','returned') FOR UPDATE`, [req.params.businessId, req.user.company_id, req.user.id]);
        if (!rows.length) throw Object.assign(new Error('Draft/returned bill not found'), { statusCode: 409 });
        const bill = rows[0];
        if (workflow.require_attachment) { const count = Number((await client.query(`SELECT count(*) FROM file_attachments WHERE entity_type='BILL_SUBMISSION' AND entity_id=$1`, [bill.business_id])).rows[0].count); if (!count) throw Object.assign(new Error('At least one supporting document is required'), { statusCode: 409 }); }
        const updated = (await client.query(`UPDATE bill_submissions SET status='submitted',submitted_at=now() WHERE id=$1 RETURNING *`, [bill.id])).rows[0];
        await event(client, bill, 'SUBMITTED', bill.status, 'submitted', null, req.user.id);
        await signoff(client, req.user.company_id, 'BILL_SUBMISSION', bill.business_id, 'submitted', req.user.id);
        return updated;
    });
    await logAction({ actorUserId: req.user.id, action: 'BILL_SUBMITTED', entityType: 'BILL_SUBMISSION', entityId: req.params.businessId });
    res.json({ bill: result });
}

async function review(req, res) {
    const { decision, notes } = req.body;
    const workflow = await billWorkflow(req.user.company_id), step = (workflow.approval_steps || [])[0] || { permission: 'ACCOUNTS_APPROVE', allowReject: true };
    if (!req.permissions.has(step.permission)) return res.status(403).json({ error: `Workflow requires permission: ${step.permission}` });
    if (!['approve', 'reject', 'return'].includes(decision)) return res.status(400).json({ error: 'Decision must be approve, reject, or return' });
    if (decision !== 'approve' && !notes) return res.status(400).json({ error: 'Notes are required when rejecting or returning a bill' });
    const result = await withTransaction(async (client) => {
        const bill = (await client.query(`SELECT * FROM bill_submissions WHERE business_id=$1 AND company_id=$2 AND status='submitted' FOR UPDATE`, [req.params.businessId, req.user.company_id])).rows[0];
        if (!bill) throw Object.assign(new Error('Submitted bill not found'), { statusCode: 409 });
        const status = decision === 'approve' ? 'approved' : decision === 'return' ? 'returned' : 'rejected';
        let voucherId = null;
        if (decision === 'approve') voucherId = await createVoucher(client, { companyId: req.user.company_id, documentType: 'APPROVED_PAYABLE_VOUCHER', vendorId: bill.vendor_id, sourceId: bill.business_id, amount: bill.amount, description: notes || bill.description || `Approved claim ${bill.business_id}`, createdBy: req.user.id });
        const updated = (await client.query(`UPDATE bill_submissions SET status=$1,reviewed_by=$2,reviewed_at=now(),review_notes=$3,returned_at=CASE WHEN $1='returned' THEN now() ELSE returned_at END,returned_by=CASE WHEN $1='returned' THEN $2 ELSE returned_by END,approved_voucher_business_id=COALESCE($4,approved_voucher_business_id) WHERE id=$5 RETURNING *`, [status, req.user.id, notes || null, voucherId, bill.id])).rows[0];
        await event(client, bill, decision.toUpperCase(), 'submitted', status, notes, req.user.id);
        await signoff(client, req.user.company_id, 'BILL_SUBMISSION', bill.business_id, decision === 'approve' ? 'approved' : 'reviewed', req.user.id, null, notes);
        if (voucherId) { await signoff(client, req.user.company_id, 'APPROVED_PAYABLE_VOUCHER', voucherId, 'prepared', bill.submitter_user_id); await signoff(client, req.user.company_id, 'APPROVED_PAYABLE_VOUCHER', voucherId, 'approved', req.user.id, null, notes); }
        return { bill: updated, voucherId };
    });
    if (result.voucherId) await generateForEntitySafe('APPROVED_PAYABLE_VOUCHER', result.voucherId);
    await logAction({ actorUserId: req.user.id, action: `BILL_${decision.toUpperCase()}`, entityType: 'BILL_SUBMISSION', entityId: req.params.businessId, after: { notes, voucherId: result.voucherId } });
    res.json(result);
}

async function pay(req, res) {
    if (!req.permissions.has('ACCOUNTS_CREATE')) return res.status(403).json({ error: 'Accounts payment permission required' });
    const { accountBusinessId, paymentMethod, paymentReference, paymentDate, notes } = req.body;
    if (!accountBusinessId) return res.status(400).json({ error: 'Payment account is required' });
    const result = await withTransaction(async (client) => {
        const bill = (await client.query(`SELECT * FROM bill_submissions WHERE business_id=$1 AND company_id=$2 AND status='approved' FOR UPDATE`, [req.params.businessId, req.user.company_id])).rows[0];
        const account = (await client.query(`SELECT id FROM accounts WHERE business_id=$1 AND company_id=$2 AND deleted_at IS NULL FOR UPDATE`, [accountBusinessId, req.user.company_id])).rows[0];
        if (!bill || !account) throw Object.assign(new Error('Approved bill or payment account not found'), { statusCode: 404 });
        await recordAccountTransaction(client, { accountId: account.id, transactionType: 'WITHDRAWAL', amount: bill.amount, referenceType: 'BILL_PAYMENT', referenceId: bill.business_id, createdBy: req.user.id, notes: notes || bill.description });
        const voucherId = await createVoucher(client, { companyId: req.user.company_id, documentType: 'PAYMENT_VOUCHER', accountId: account.id, vendorId: bill.vendor_id, sourceId: bill.business_id, amount: bill.amount, description: notes || bill.description || `Payment ${bill.business_id}`, createdBy: req.user.id });
        const updated = (await client.query(`UPDATE bill_submissions SET status='paid',paid_account_id=$1,paid_at=now(),paid_by=$2,payment_method=$3,payment_reference=$4,payment_date=COALESCE($5::date,CURRENT_DATE),payment_voucher_business_id=$6 WHERE id=$7 RETURNING *`, [account.id, req.user.id, paymentMethod || 'bank', paymentReference || null, paymentDate || null, voucherId, bill.id])).rows[0];
        await event(client, bill, 'PAID', 'approved', 'paid', notes, req.user.id);
        await signoff(client, req.user.company_id, 'PAYMENT_VOUCHER', voucherId, 'approved', bill.reviewed_by);
        await signoff(client, req.user.company_id, 'PAYMENT_VOUCHER', voucherId, 'paid', req.user.id, null, paymentReference);
        return { bill: updated, voucherId };
    });
    await generateForEntitySafe('PAYMENT_VOUCHER', result.voucherId);
    await logAction({ actorUserId: req.user.id, action: 'BILL_PAID', entityType: 'BILL_SUBMISSION', entityId: req.params.businessId, after: { voucherId: result.voucherId, paymentReference } });
    res.json({ message: 'Payment confirmed and voucher generated', voucherBusinessId: result.voucherId, bill: result.bill });
}

async function accept(req, res) {
    const { acceptedByName, notes } = req.body;
    const result = await withTransaction(async (client) => {
        const bill = (await client.query(`SELECT * FROM bill_submissions WHERE business_id=$1 AND company_id=$2 AND status='paid' FOR UPDATE`, [req.params.businessId, req.user.company_id])).rows[0];
        if (!bill) throw Object.assign(new Error('Paid bill not found or acceptance already recorded'), { statusCode: 409 });
        const allowed = bill.submitter_user_id === req.user.id || bill.claimant_user_id === req.user.id || req.permissions.has('ACCOUNTS_CREATE');
        if (!allowed) throw Object.assign(new Error('Only the claimant, submitter, or Accounts can confirm receipt'), { statusCode: 403 });
        const name = acceptedByName || req.user.username;
        const voucherId = await createVoucher(client, { companyId: req.user.company_id, documentType: 'PAYMENT_ACCEPTANCE_VOUCHER', accountId: bill.paid_account_id, vendorId: bill.vendor_id, sourceId: bill.business_id, amount: bill.amount, description: notes || `Payment accepted by ${name}`, createdBy: req.user.id });
        const updated = (await client.query(`UPDATE bill_submissions SET status='accepted',accepted_by=$1,accepted_by_name=$2,accepted_at=now(),acceptance_notes=$3,acceptance_voucher_business_id=$4 WHERE id=$5 RETURNING *`, [req.user.id, name, notes || null, voucherId, bill.id])).rows[0];
        await event(client, bill, 'PAYMENT_ACCEPTED', 'paid', 'accepted', notes, req.user.id);
        await signoff(client, req.user.company_id, 'PAYMENT_ACCEPTANCE_VOUCHER', voucherId, 'paid', bill.paid_by);
        await signoff(client, req.user.company_id, 'PAYMENT_ACCEPTANCE_VOUCHER', voucherId, 'received', req.user.id, name, notes);
        return { bill: updated, voucherId };
    });
    await generateForEntitySafe('PAYMENT_ACCEPTANCE_VOUCHER', result.voucherId);
    await logAction({ actorUserId: req.user.id, action: 'BILL_PAYMENT_ACCEPTED', entityType: 'BILL_SUBMISSION', entityId: req.params.businessId, after: { voucherId: result.voucherId } });
    res.json({ message: 'Payment acceptance recorded', voucherBusinessId: result.voucherId, bill: result.bill });
}

module.exports = { list, get, create, update, submit, review, pay, accept };
