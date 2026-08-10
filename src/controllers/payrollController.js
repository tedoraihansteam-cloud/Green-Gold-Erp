const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { logAction } = require('../services/auditLogger');
const { recordAccountTransaction } = require('./accountController');
const {createFinancialDocument}=require('../services/financialDocumentService');

function computeTotals(item) {
    const grossPay = Number(item.basic) + Number(item.house_rent) + Number(item.medical) + Number(item.transport)
        + Number(item.food) + Number(item.special_allowance) + Number(item.overtime) + Number(item.bonus);
    const totalDeductions = Number(item.provident_fund_deduction) + Number(item.tax_deduction) + Number(item.late_deduction)
        + Number(item.loan_deduction) + Number(item.advance_deduction) + Number(item.other_deduction);
    return { grossPay, totalDeductions, netPay: grossPay - totalDeductions };
}

// Browser number inputs send '' (not null/undefined) when a field is left
// blank, which `??` doesn't treat as "unset" - so an empty field would
// otherwise flow straight through into a NUMERIC column and fail. This
// treats '', null, and undefined all as "keep the existing value".
function numOrFallback(value, fallback) {
    if (value === '' || value === null || value === undefined) return fallback;
    return Number(value);
}

// ---------------- Salary templates ----------------

async function createSalaryTemplate(req, res) {
    const { name, basic, houseRent, medical, transport, food, specialAllowance, providentFundPercent } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const businessId = await generateNextId('SALARY_TEMPLATE');
    const { rows } = await query(
        `INSERT INTO salary_templates (business_id, company_id, name, basic, house_rent, medical, transport, food, special_allowance, provident_fund_percent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [businessId, req.user.company_id, name, basic || 0, houseRent || 0, medical || 0, transport || 0, food || 0, specialAllowance || 0, providentFundPercent || 0]
    );
    await logAction({ actorUserId: req.user.id, action: 'SALARY_TEMPLATE_CREATED', entityType: 'SALARY_TEMPLATE', entityId: rows[0].business_id, after: rows[0] });
    await generateForEntitySafe('SALARY_TEMPLATE', rows[0].business_id);
    res.status(201).json({ template: rows[0] });
}

async function listSalaryTemplates(req, res) {
    const { rows } = await query(`SELECT * FROM salary_templates WHERE company_id = $1 ORDER BY name`, [req.user.company_id]);
    res.json({ templates: rows });
}

// ---------------- Employee salary (permanent history, never overwritten) ----------------

/**
 * Setting a salary is always a deliberate, manual HR action (rule #12:
 * increments are manual-approval-only - there is no automatic-increase
 * code path anywhere). It closes the current history row and inserts a
 * new one; both stay queryable forever.
 */
async function setEmployeeSalary(req, res) {
    const { employeeBusinessId } = req.params;
    const { templateBusinessId, basic, houseRent, medical, transport, food, specialAllowance, providentFundPercent, effectiveDate, notes } = req.body;

    const result = await withTransaction(async (client) => {
        const { rows: empRows } = await client.query(
            `SELECT id FROM master_employees WHERE business_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
            [employeeBusinessId, req.user.company_id]
        );
        if (empRows.length === 0) throw Object.assign(new Error('Employee not found'), { statusCode: 404 });
        const employeeId = empRows[0].id;

        let templateId = null;
        let values = { basic: basic || 0, houseRent: houseRent || 0, medical: medical || 0, transport: transport || 0, food: food || 0, specialAllowance: specialAllowance || 0, providentFundPercent: providentFundPercent || 0 };

        if (templateBusinessId) {
            const { rows: tplRows } = await client.query(`SELECT * FROM salary_templates WHERE business_id = $1 AND company_id = $2`, [templateBusinessId, req.user.company_id]);
            if (tplRows.length === 0) throw Object.assign(new Error('Salary template not found'), { statusCode: 404 });
            templateId = tplRows[0].id;
            const t = tplRows[0];
            values = { basic: t.basic, houseRent: t.house_rent, medical: t.medical, transport: t.transport, food: t.food, specialAllowance: t.special_allowance, providentFundPercent: t.provident_fund_percent };
        }

        const effDate = effectiveDate || new Date().toISOString().slice(0, 10);

        // Close the currently-open history row, if any.
        await client.query(
            `UPDATE employee_salary_history SET end_date = $1::date - INTERVAL '1 day'
             WHERE employee_id = $2 AND end_date IS NULL AND effective_date < $1::date`,
            [effDate, employeeId]
        );

        const { rows } = await client.query(
            `INSERT INTO employee_salary_history (company_id, employee_id, template_id, basic, house_rent, medical, transport, food, special_allowance, provident_fund_percent, effective_date, set_by, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             RETURNING *`,
            [req.user.company_id, employeeId, templateId, values.basic, values.houseRent, values.medical, values.transport, values.food, values.specialAllowance, values.providentFundPercent, effDate, req.user.id, notes || null]
        );
        return rows[0];
    });

    await logAction({ actorUserId: req.user.id, action: 'EMPLOYEE_SALARY_SET', entityType: 'EMPLOYEE', entityId: employeeBusinessId, after: result });
    res.status(201).json({ salary: result });
}

async function getEmployeeSalaryHistory(req, res) {
    const { rows: empRows } = await query(
        `SELECT id FROM master_employees WHERE business_id = $1 AND company_id = $2`,
        [req.params.employeeBusinessId, req.user.company_id]
    );
    if (empRows.length === 0) return res.status(404).json({ error: 'Employee not found' });

    const { rows } = await query(
        `SELECT * FROM employee_salary_history WHERE employee_id = $1 ORDER BY effective_date DESC`,
        [empRows[0].id]
    );
    res.json({ history: rows });
}

async function getCurrentSalary(client, employeeId, asOfDate) {
    const { rows } = await client.query(
        `SELECT * FROM employee_salary_history
         WHERE employee_id = $1 AND effective_date <= $2 AND (end_date IS NULL OR end_date >= $2)
         ORDER BY effective_date DESC LIMIT 1`,
        [employeeId, asOfDate]
    );
    return rows[0] || null;
}

// ---------------- Payroll runs ----------------

async function createPayrollRun(req, res) {
    const { periodYear, periodMonth } = req.body;
    if (!periodYear || !periodMonth) return res.status(400).json({ error: 'periodYear and periodMonth are required' });

    const run = await withTransaction(async (client) => {
        const payingAccountId = null; // Accounts selects the funding account during approval.

        const businessId = await generateNextId('PAYROLL_RUN');
        const { rows: runRows } = await client.query(
            `INSERT INTO payroll_runs (business_id, company_id, period_year, period_month, paying_account_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [businessId, req.user.company_id, periodYear, periodMonth, payingAccountId, req.user.id]
        );
        const runRow = runRows[0];

        const periodEndDate = new Date(periodYear, periodMonth, 0).toISOString().slice(0, 10); // last day of the period month

        const { rows: employees } = await client.query(
            `SELECT id, business_id, full_name FROM master_employees WHERE company_id = $1 AND status = 'active' AND deleted_at IS NULL`,
            [req.user.company_id]
        );

        let seeded = 0;
        for (const emp of employees) {
            const salary = await getCurrentSalary(client, emp.id, periodEndDate);
            if (!salary) continue; // no salary on file yet - skip, HR can add manually later if needed
            const totals = computeTotals({ ...salary, overtime: 0, bonus: 0, provident_fund_deduction: (Number(salary.basic) * Number(salary.provident_fund_percent)) / 100, tax_deduction: 0, late_deduction: 0, loan_deduction: 0, advance_deduction: 0, other_deduction: 0 });
            await client.query(
                `INSERT INTO payroll_items (payroll_run_id, employee_id, basic, house_rent, medical, transport, food, special_allowance, provident_fund_deduction, gross_pay, total_deductions, net_pay)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [runRow.id, emp.id, salary.basic, salary.house_rent, salary.medical, salary.transport, salary.food, salary.special_allowance,
                 (Number(salary.basic) * Number(salary.provident_fund_percent)) / 100, totals.grossPay, totals.totalDeductions, totals.netPay]
            );
            seeded++;
        }

        return { ...runRow, employeesSeeded: seeded, employeesSkipped: employees.length - seeded };
    });

    await generateForEntitySafe('PAYROLL_RUN', run.business_id);
    await logAction({ actorUserId: req.user.id, action: 'PAYROLL_RUN_CREATED', entityType: 'PAYROLL_RUN', entityId: run.business_id, after: run });
    res.status(201).json({ payrollRun: run });
}

// QR/barcode generation is best-effort for payroll runs - not critical to
// the workflow the way it is for gate passes, so a failure here shouldn't
// block payroll creation.
async function generateForEntitySafe(entityType, businessId) {
    try {
        const { generateForEntity } = require('../services/qrBarcodeService');
        await generateForEntity(entityType, businessId);
    } catch (err) {
        console.error(`QR/barcode generation failed for ${entityType} ${businessId}:`, err.message);
    }
}

async function listPayrollRuns(req, res) {
    const hrViewer = req.permissions.has('HR_VIEW');
    const { rows } = await query(
        `SELECT pr.*, a.business_id AS paying_account_business_id, a.name AS paying_account_name,
                (SELECT count(*) FROM payroll_items WHERE payroll_run_id = pr.id) AS employee_count,
                (SELECT COALESCE(sum(net_pay), 0) FROM payroll_items WHERE payroll_run_id = pr.id) AS total_net_pay
         FROM payroll_runs pr LEFT JOIN accounts a ON a.id = pr.paying_account_id
         WHERE pr.company_id = $1 AND ($2::boolean OR pr.status IN('submitted_to_accounts','accounts_approved','processed'))
         ORDER BY pr.period_year DESC, pr.period_month DESC`,
        [req.user.company_id, hrViewer]
    );
    res.json({ payrollRuns: rows });
}

async function getPayrollRun(req, res) {
    const hrViewer = req.permissions.has('HR_VIEW');
    const { rows: runRows } = await query(
        `SELECT pr.*, a.business_id AS paying_account_business_id, a.name AS paying_account_name
         FROM payroll_runs pr LEFT JOIN accounts a ON a.id = pr.paying_account_id
         WHERE pr.business_id = $1 AND pr.company_id = $2 AND ($3::boolean OR pr.status IN('submitted_to_accounts','accounts_approved','processed'))`,
        [req.params.businessId, req.user.company_id, hrViewer]
    );
    if (runRows.length === 0) return res.status(404).json({ error: 'Payroll run not found' });

    const { rows: items } = await query(
        `SELECT pi.*, e.business_id AS employee_business_id, e.full_name, e.designation
         FROM payroll_items pi JOIN master_employees e ON e.id = pi.employee_id
         WHERE pi.payroll_run_id = $1 ORDER BY e.full_name`,
        [runRows[0].id]
    );
    res.json({ payrollRun: { ...runRows[0], items } });
}

async function updatePayrollItem(req, res) {
    const { businessId, employeeBusinessId } = req.params;
    const { overtime, bonus, providentFundDeduction, taxDeduction, lateDeduction, loanDeduction, advanceDeduction, otherDeduction } = req.body;

    const item = await withTransaction(async (client) => {
        const { rows: runRows } = await client.query(`SELECT * FROM payroll_runs WHERE business_id = $1 AND company_id = $2`, [businessId, req.user.company_id]);
        if (runRows.length === 0) throw Object.assign(new Error('Payroll run not found'), { statusCode: 404 });
        if (runRows[0].status !== 'draft') throw Object.assign(new Error('Only draft payroll runs can be adjusted'), { statusCode: 409 });

        const { rows: empRows } = await client.query(`SELECT id FROM master_employees WHERE business_id = $1 AND company_id = $2`, [employeeBusinessId, req.user.company_id]);
        if (empRows.length === 0) throw Object.assign(new Error('Employee not found'), { statusCode: 404 });

        const { rows: itemRows } = await client.query(`SELECT * FROM payroll_items WHERE payroll_run_id = $1 AND employee_id = $2`, [runRows[0].id, empRows[0].id]);
        if (itemRows.length === 0) throw Object.assign(new Error('This employee is not on this payroll run'), { statusCode: 404 });
        const existing = itemRows[0];

        const updated = {
            ...existing,
            overtime: numOrFallback(overtime, existing.overtime),
            bonus: numOrFallback(bonus, existing.bonus),
            provident_fund_deduction: numOrFallback(providentFundDeduction, existing.provident_fund_deduction),
            tax_deduction: numOrFallback(taxDeduction, existing.tax_deduction),
            late_deduction: numOrFallback(lateDeduction, existing.late_deduction),
            loan_deduction: numOrFallback(loanDeduction, existing.loan_deduction),
            advance_deduction: numOrFallback(advanceDeduction, existing.advance_deduction),
            other_deduction: numOrFallback(otherDeduction, existing.other_deduction)
        };
        const totals = computeTotals(updated);

        const { rows } = await client.query(
            `UPDATE payroll_items SET overtime = $1, bonus = $2, provident_fund_deduction = $3, tax_deduction = $4,
                late_deduction = $5, loan_deduction = $6, advance_deduction = $7, other_deduction = $8,
                gross_pay = $9, total_deductions = $10, net_pay = $11
             WHERE id = $12 RETURNING *`,
            [updated.overtime, updated.bonus, updated.provident_fund_deduction, updated.tax_deduction, updated.late_deduction,
             updated.loan_deduction, updated.advance_deduction, updated.other_deduction, totals.grossPay, totals.totalDeductions, totals.netPay, existing.id]
        );
        return rows[0];
    });

    res.json({ item });
}

/**
 * The one irreversible step: posts a single aggregate withdrawal for the
 * whole run's net pay total, rather than one transaction per employee,
 * to keep the ledger readable (rule #11: auto-post from operational
 * transactions, without creating duplicate manual entry work).
 */
async function processPayrollRun(req, res) {
    const result = await withTransaction(async (client) => {
        const { rows: runRows } = await client.query(
            `SELECT * FROM payroll_runs WHERE business_id = $1 AND company_id = $2 FOR UPDATE`,
            [req.params.businessId, req.user.company_id]
        );
        if (runRows.length === 0) throw Object.assign(new Error('Payroll run not found'), { statusCode: 404 });
        const run = runRows[0];
        if (run.status !== 'accounts_approved') throw Object.assign(new Error('Accounts must approve the HR pay order before payment'), { statusCode: 409 });
        if (!run.paying_account_id) throw Object.assign(new Error('This payroll run has no paying account set'), { statusCode: 400 });

        const { rows: totalRows } = await client.query(`SELECT COALESCE(sum(net_pay), 0) AS total FROM payroll_items WHERE payroll_run_id = $1`, [run.id]);
        const total = Number(totalRows[0].total);
        if (total <= 0) throw Object.assign(new Error('This payroll run has no employees with a net payable amount'), { statusCode: 400 });

        await recordAccountTransaction(client, {
            accountId: run.paying_account_id, transactionType: 'WITHDRAWAL', amount: total,
            referenceType: 'PAYROLL', referenceId: run.business_id, createdBy: req.user.id,
            notes: `Payroll ${run.period_year}-${String(run.period_month).padStart(2, '0')}`
        });
        const voucher=await createFinancialDocument(client,{companyId:req.user.company_id,documentType:'PAYMENT_VOUCHER',accountId:run.paying_account_id,sourceType:'PAYROLL',sourceId:run.business_id,amount:total,description:`Payroll ${run.period_year}-${String(run.period_month).padStart(2,'0')}`,createdBy:req.user.id});

        const { rows: updatedRows } = await client.query(
            `UPDATE payroll_runs SET status = 'processed', processed_by = $1, processed_at = now() WHERE id = $2 RETURNING *`,
            [req.user.id, run.id]
        );
        return { ...updatedRows[0], totalPaid: total, voucherBusinessId:voucher.business_id };
    });

    await logAction({ actorUserId: req.user.id, action: 'PAYROLL_RUN_PROCESSED', entityType: 'PAYROLL_RUN', entityId: result.business_id, after: { totalPaid: result.totalPaid } });
    await generateForEntitySafe('PAYMENT_VOUCHER',result.voucherBusinessId);
    res.json({ message: 'Payroll processed and posted', payrollRun: result });
}

async function payrollWorkflow(companyId){const {rows}=await query(`SELECT * FROM workflow_definitions WHERE company_id=$1 AND workflow_key='payroll_pay_order'`,[companyId]);return rows[0]||{enabled:true,approval_steps:[{permission:'HR_APPROVE'},{permission:'ACCOUNTS_APPROVE'}]};}
async function submitPayrollPayOrder(req,res){const workflow=await payrollWorkflow(req.user.company_id),step=(workflow.approval_steps||[])[0]||{permission:'HR_APPROVE'};if(!workflow.enabled)return res.status(409).json({error:'Payroll pay-order workflow is disabled'});if(!req.permissions.has(step.permission))return res.status(403).json({error:`Workflow requires permission: ${step.permission}`});const {rows}=await query(`UPDATE payroll_runs SET status='submitted_to_accounts',submitted_by=$1,submitted_at=now() WHERE business_id=$2 AND company_id=$3 AND status='draft' RETURNING *`,[req.user.id,req.params.businessId,req.user.company_id]);if(!rows.length)return res.status(409).json({error:'Only a draft payroll can be submitted'});await logAction({actorUserId:req.user.id,action:'PAYROLL_PAY_ORDER_SUBMITTED',entityType:'PAYROLL_RUN',entityId:req.params.businessId});res.json({payrollRun:rows[0]});}
async function approvePayrollPayOrder(req,res){const workflow=await payrollWorkflow(req.user.company_id),step=(workflow.approval_steps||[])[1]||{permission:'ACCOUNTS_APPROVE'};if(!workflow.enabled)return res.status(409).json({error:'Payroll pay-order workflow is disabled'});if(!req.permissions.has(step.permission))return res.status(403).json({error:`Workflow requires permission: ${step.permission}`});const {payingAccountBusinessId,notes}=req.body;if(!payingAccountBusinessId)return res.status(400).json({error:'payingAccountBusinessId is required'});const {rows}=await query(`UPDATE payroll_runs pr SET status='accounts_approved',paying_account_id=a.id,accounts_approved_by=$1,accounts_approved_at=now(),approval_notes=$2 FROM accounts a WHERE pr.business_id=$3 AND pr.company_id=$4 AND pr.status='submitted_to_accounts' AND a.business_id=$5 AND a.company_id=$4 RETURNING pr.*`,[req.user.id,notes||null,req.params.businessId,req.user.company_id,payingAccountBusinessId]);if(!rows.length)return res.status(409).json({error:'Submitted payroll or payment account not found'});await logAction({actorUserId:req.user.id,action:'PAYROLL_PAY_ORDER_APPROVED',entityType:'PAYROLL_RUN',entityId:req.params.businessId});res.json({payrollRun:rows[0]});}

module.exports = {
    createSalaryTemplate, listSalaryTemplates, setEmployeeSalary, getEmployeeSalaryHistory,
    createPayrollRun, listPayrollRuns, getPayrollRun, updatePayrollItem, submitPayrollPayOrder, approvePayrollPayOrder, processPayrollRun
};
