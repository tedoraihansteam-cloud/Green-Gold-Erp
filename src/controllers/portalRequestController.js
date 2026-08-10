const { query } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { logAction } = require('../services/auditLogger');

const TEMPLATES = [
  { code: 'LEAVE', name: 'Leave application', department: 'HR' },
  { code: 'SPECIAL_LEAVE', name: 'Special leave application', department: 'HR' },
  { code: 'NOC', name: 'No objection certificate request', department: 'HR' },
  { code: 'ALLOWANCE', name: 'Additional allowance request', department: 'HR' },
  { code: 'APOLOGY', name: 'Explanation / apology letter', department: 'HR' },
  { code: 'ATTENDANCE', name: 'Attendance correction', department: 'HR' },
  { code: 'TASK_REPORT', name: 'Task completion report', department: 'HR' },
  { code: 'INCIDENT', name: 'Incident report', department: 'OPERATIONS' },
  { code: 'MACHINE_REPORT', name: 'Machinery report', department: 'MANUFACTURING' },
  { code: 'PRE_RENTAL_BOOKING', name: 'Advance storage booking request', department: 'OPERATIONS' },
  { code: 'MONTHLY_BILLING_STOCK_REPORT', name: 'Monthly billing or stock report request', department: 'ACCOUNTS' },
  { code: 'DELIVERY_REQUEST', name: 'Delivery request', department: 'LOGISTICS' },
  { code: 'GATE_PASS_REQUEST', name: 'Gate pass request', department: 'SECURITY' },
  { code: 'INVOICE_REQUEST', name: 'Invoice preparation or review request', department: 'ACCOUNTS' },
  { code: 'SERVICE_REQUEST', name: 'Service request', department: 'OPERATIONS' },
  { code: 'MACHINE_MAINTENANCE_REQUEST', name: 'Machinery maintenance request', department: 'MANUFACTURING' },
  { code: 'PROCUREMENT_REQUEST', name: 'Procurement or purchase request', department: 'PROCUREMENT' },
  { code: 'STOCK_TRANSFER_REQUEST', name: 'Stock transfer request', department: 'INVENTORY' },
  { code: 'RENTAL_REQUEST', name: 'Rental or storage request', department: 'OPERATIONS' },
  { code: 'PAYMENT_REQUEST', name: 'Payment request', department: 'ACCOUNTS' },
  { code: 'SPECIAL_REQUEST', name: 'Special request', department: 'ADMIN' },
];

const CUSTOMER_REQUEST_CODES = new Set([
  'PRE_RENTAL_BOOKING',
  'MONTHLY_BILLING_STOCK_REPORT',
  'DELIVERY_REQUEST',
]);

function isCustomer(req) {
  return req.user.account_type === 'customer';
}

async function templates(req, res) {
  const availableTemplates = isCustomer(req)
    ? TEMPLATES.filter((template) => CUSTOMER_REQUEST_CODES.has(template.code))
    : TEMPLATES;
  res.json({ templates: availableTemplates });
}

async function list(req, res) {
  const hr = req.permissions.has('HR_APPROVE');
  const accounts = req.permissions.has('ACCOUNTS_APPROVE');
  const admin = req.permissions.has('USER_MANAGEMENT_APPROVE');
  const reviewer = hr || accounts || admin;
  const { rows } = await query(
    `SELECT pr.*,u.username
     FROM portal_requests pr
     JOIN users u ON u.id=pr.requester_user_id
     WHERE pr.company_id=$1 AND (
       pr.requester_user_id=$2
       OR ($3::boolean AND pr.department='HR')
       OR ($4::boolean AND (pr.department='ACCOUNTS' OR pr.requires_accounts))
       OR ($5::boolean AND pr.department NOT IN('HR','ACCOUNTS'))
       OR EXISTS(SELECT 1 FROM workflow_definitions wd CROSS JOIN LATERAL jsonb_array_elements(wd.approval_steps) step WHERE wd.company_id=pr.company_id AND wd.enabled=true AND wd.workflow_key='request_'||lower(pr.request_type) AND step->>'assigneeUserId'=$2::text)
     )
     ORDER BY pr.created_at DESC`,
    [req.user.company_id, req.user.id, hr, accounts, admin],
  );
  const { rows: workflows } = await query(`SELECT workflow_key,approval_steps FROM workflow_definitions WHERE company_id=$1 AND workflow_key LIKE 'request_%'`,[req.user.company_id]);
  const assigned = new Map(workflows.map(w=>[w.workflow_key,(w.approval_steps||[])]));
  const requests = rows.map((row) => ({
    ...row,
    can_review: (['submitted','accounts_pending'].includes(row.status) && assigned.get(`request_${row.request_type.toLowerCase()}`)?.some(step=>step.assigneeUserId===req.user.id&&req.permissions.has(step.permission))) || (row.status === 'accounts_pending' && accounts)
      || (row.status === 'submitted' && row.department === 'ACCOUNTS' && accounts)
      || (row.status === 'submitted' && row.department === 'HR' && hr)
      || (row.status === 'submitted' && !['HR','ACCOUNTS'].includes(row.department) && admin),
  }));
  res.json({ requests, reviewer });
}

async function create(req, res) {
  const {
    requestType,
    subject,
    body,
    amount,
    details,
    requestedDate,
    submit,
  } = req.body;

  if (!requestType || !subject) {
    return res.status(400).json({ error: 'requestType and subject are required' });
  }

  const template = TEMPLATES.find((item) => item.code === requestType);
  if (!template) return res.status(400).json({ error: 'Unknown request type' });

  if (isCustomer(req) && !CUSTOMER_REQUEST_CODES.has(requestType)) {
    return res.status(403).json({ error: 'This request type is not available in the customer portal' });
  }

  if (
    isCustomer(req)
    && ['PRE_RENTAL_BOOKING', 'DELIVERY_REQUEST'].includes(requestType)
    && !requestedDate
  ) {
    return res.status(400).json({ error: 'Requested date is required for booking and delivery requests' });
  }

  const safeDetails = details && typeof details === 'object' && !Array.isArray(details)
    ? details
    : {};
  const businessId = await generateNextId('PORTAL_REQUEST');
  const searchable = `${requestType} ${subject} ${body || ''}`.toLowerCase();
  const financialTerms = /payment|pay |payable|allowance|reimburse|expense|advance|refund|cash|bill|invoice|salary|wage|fee|purchase/;
  const requiresAccounts = (!isCustomer(req) && Number(amount) > 0)
    || requestType === 'ALLOWANCE'
    || financialTerms.test(searchable);
  const { rows } = await query(
    `INSERT INTO portal_requests(
       business_id,company_id,requester_user_id,request_type,department,subject,
       body,amount,details,requested_date,status,submitted_at,requires_accounts
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      businessId,
      req.user.company_id,
      req.user.id,
      requestType,
      requiresAccounts ? 'ACCOUNTS' : template.department,
      subject,
      body || null,
      isCustomer(req) ? null : (amount || null),
      safeDetails,
      requestedDate || null,
      submit ? 'submitted' : 'draft',
      submit ? new Date() : null,
      requiresAccounts,
    ],
  );
  await logAction({
    actorUserId: req.user.id,
    action: submit ? 'PORTAL_REQUEST_SUBMITTED' : 'PORTAL_REQUEST_DRAFTED',
    entityType: 'PORTAL_REQUEST',
    entityId: businessId,
  });
  return res.status(201).json({ request: rows[0] });
}

async function review(req, res) {
  const { decision, notes } = req.body;
  if (!['approve', 'reject'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be approve or reject' });
  }
  const current = (await query(`SELECT * FROM portal_requests WHERE business_id=$1 AND company_id=$2`, [req.params.businessId, req.user.company_id])).rows[0];
  if (!current || !['submitted','accounts_pending'].includes(current.status)) return res.status(409).json({ error: 'Reviewable request not found' });
  const isAccountsStep = current.status === 'accounts_pending' || current.department === 'ACCOUNTS';
  const workflow=(await query(`SELECT approval_steps FROM workflow_definitions WHERE company_id=$1 AND workflow_key=$2 AND enabled=true`,[req.user.company_id,`request_${current.request_type.toLowerCase()}`])).rows[0];
  const assignedToUser=(workflow?.approval_steps||[]).some(step=>step.assigneeUserId===req.user.id&&req.permissions.has(step.permission));
  const allowed = assignedToUser || (isAccountsStep
    ? req.permissions.has('ACCOUNTS_APPROVE')
    : current.department === 'HR'
      ? req.permissions.has('HR_APPROVE')
      : req.permissions.has('USER_MANAGEMENT_APPROVE'));
  if (!allowed) return res.status(403).json({ error: isAccountsStep ? 'Accounts approval permission required' : `${current.department} approval permission required` });
  let sql;
  if (decision === 'reject') {
    sql = `UPDATE portal_requests SET status='rejected',reviewed_by=$1,reviewed_at=now(),review_notes=$2,${isAccountsStep ? 'accounts_review_status' : 'department_review_status'}='rejected',${isAccountsStep ? 'accounts_reviewed_by' : 'department_reviewed_by'}=$1,${isAccountsStep ? 'accounts_reviewed_at' : 'department_reviewed_at'}=now(),${isAccountsStep ? 'accounts_review_notes' : 'department_review_notes'}=$2 WHERE id=$3 RETURNING *`;
  } else if (!isAccountsStep && current.requires_accounts) {
    sql = `UPDATE portal_requests SET status='accounts_pending',department_review_status='approved',department_reviewed_by=$1,department_reviewed_at=now(),department_review_notes=$2 WHERE id=$3 RETURNING *`;
  } else {
    sql = `UPDATE portal_requests SET status='approved',reviewed_by=$1,reviewed_at=now(),review_notes=$2,${isAccountsStep ? 'accounts_review_status' : 'department_review_status'}='approved',${isAccountsStep ? 'accounts_reviewed_by' : 'department_reviewed_by'}=$1,${isAccountsStep ? 'accounts_reviewed_at' : 'department_reviewed_at'}=now(),${isAccountsStep ? 'accounts_review_notes' : 'department_review_notes'}=$2 WHERE id=$3 RETURNING *`;
  }
  const { rows } = await query(sql, [req.user.id, notes || null, current.id]);
  await logAction({
    actorUserId: req.user.id,
    action: decision === 'approve' && !isAccountsStep && current.requires_accounts ? 'PORTAL_REQUEST_ROUTED_TO_ACCOUNTS' : `PORTAL_REQUEST_${decision.toUpperCase()}D`,
    entityType: 'PORTAL_REQUEST',
    entityId: req.params.businessId,
  });
  return res.json({ request: rows[0] });
}

module.exports = { templates, list, create, review };
