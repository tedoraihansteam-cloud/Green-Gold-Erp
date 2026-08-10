const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { logAction } = require('../services/auditLogger');
const { recordAccountTransaction } = require('./accountController');
const { generateForEntitySafe } = require('../services/qrBarcodeService');
const {createFinancialDocument}=require('../services/financialDocumentService');

async function expenseWorkflow(client,companyId){
    const {rows}=await client.query(`SELECT enabled,auto_approve_below,approval_steps FROM workflow_definitions WHERE company_id=$1 AND workflow_key='expense_approval'`,[companyId]);
    return rows[0]||{enabled:true,auto_approve_below:0,approval_steps:[]};
}

// ---------------- Expense categories ----------------

async function createCategory(req, res) {
    const { code, name } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'code and name are required' });

    try {
        const { rows } = await query(
            `INSERT INTO expense_categories (company_id, code, name) VALUES ($1, $2, $3) RETURNING *`,
            [req.user.company_id, code.toUpperCase(), name]
        );
        res.status(201).json({ category: rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'A category with this code already exists' });
        throw err;
    }
}

async function listCategories(req, res) {
    const { rows } = await query(
        `SELECT * FROM expense_categories WHERE company_id = $1 ORDER BY name`,
        [req.user.company_id]
    );
    res.json({ categories: rows });
}

// ---------------- Expenses ----------------

async function createExpense(req, res) {
    const { categoryId, accountBusinessId, amount, description, paidTo, expenseDate,costCenterBusinessId,financialClassification='OPERATING_EXPENSE',taxRate=0,taxAmount=0,taxReference } = req.body;
    if (!categoryId || !accountBusinessId || !amount || Number(amount) <= 0) {
        return res.status(400).json({ error: 'categoryId, accountBusinessId, and a positive amount are required' });
    }

    const expense = await withTransaction(async (client) => {
        const { rows: accountRows } = await client.query(
            `SELECT id FROM accounts WHERE business_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
            [accountBusinessId, req.user.company_id]
        );
        if (accountRows.length === 0) throw Object.assign(new Error('Account not found'), { statusCode: 404 });
        const accountId = accountRows[0].id;

        const workflow=await expenseWorkflow(client,req.user.company_id);
        const costCenter=costCenterBusinessId?(await client.query(`SELECT id FROM cost_centers WHERE business_id=$1 AND company_id=$2 AND active=true`,[costCenterBusinessId,req.user.company_id])).rows[0]:null;if(costCenterBusinessId&&!costCenter)throw Object.assign(new Error('Active cost center not found'),{statusCode:404});
        const autoApprove = workflow.enabled && workflow.auto_approve_below!==null && Number(amount) <= Number(workflow.auto_approve_below);
        const businessId = await generateNextId('EXPENSE');

        const { rows } = await client.query(
            `INSERT INTO expenses (business_id,company_id,category_id,account_id,amount,description,paid_to,expense_date,status,created_by,approved_by,approved_at,cost_center_id,financial_classification,tax_rate,tax_amount,tax_reference)
             VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,CURRENT_DATE),$9,$10,$11,$12,$13,$14,$15,$16,$17)
             RETURNING *`,
            [
                businessId, req.user.company_id, categoryId, accountId, amount, description || null, paidTo || null, expenseDate,
                autoApprove ? 'approved' : 'pending_approval',
                req.user.id,
                autoApprove ? req.user.id : null,
                autoApprove ? new Date() : null,costCenter?.id||null,financialClassification,Number(taxRate)||0,Number(taxAmount)||0,taxReference||null
            ]
        );
        const expenseRow = rows[0];

        if (autoApprove) {
            await recordAccountTransaction(client, {
                accountId, transactionType: 'WITHDRAWAL', amount, referenceType: 'EXPENSE',
                referenceId: businessId, createdBy: req.user.id, notes: description,costCenterId:costCenter?.id,financialClassification
            });
            const voucher=await createFinancialDocument(client,{companyId:req.user.company_id,documentType:'PAYMENT_VOUCHER',accountId,sourceType:'EXPENSE',sourceId:businessId,amount,description:description||`Expense ${businessId}`,createdBy:req.user.id});expenseRow.voucherBusinessId=voucher.business_id;
        }

        return expenseRow;
    });

    await logAction({
        actorUserId: req.user.id, action: expense.status === 'approved' ? 'EXPENSE_AUTO_APPROVED' : 'EXPENSE_SUBMITTED',
        entityType: 'EXPENSE', entityId: expense.business_id, after: expense
    });

    await generateForEntitySafe('EXPENSE', expense.business_id);
    if(expense.voucherBusinessId)await generateForEntitySafe('PAYMENT_VOUCHER',expense.voucherBusinessId);
    res.status(201).json({ expense });
}

async function approveExpense(req, res) {
    const expense = await withTransaction(async (client) => {
        const { rows } = await client.query(
            `SELECT * FROM expenses WHERE business_id = $1 AND company_id = $2 FOR UPDATE`,
            [req.params.businessId, req.user.company_id]
        );
        if (rows.length === 0) throw Object.assign(new Error('Expense not found'), { statusCode: 404 });
        const exp = rows[0];
        if (exp.status !== 'pending_approval') {
            throw Object.assign(new Error(`Expense is already ${exp.status}`), { statusCode: 409 });
        }

        await recordAccountTransaction(client, {
            accountId: exp.account_id, transactionType: 'WITHDRAWAL', amount: exp.amount, referenceType: 'EXPENSE',
            referenceId: exp.business_id, createdBy: req.user.id, notes: exp.description
        });
        const voucher=await createFinancialDocument(client,{companyId:req.user.company_id,documentType:'PAYMENT_VOUCHER',accountId:exp.account_id,sourceType:'EXPENSE',sourceId:exp.business_id,amount:exp.amount,description:exp.description||`Expense ${exp.business_id}`,createdBy:req.user.id});

        const { rows: updatedRows } = await client.query(
            `UPDATE expenses SET status = 'approved', approved_by = $1, approved_at = now() WHERE id = $2 RETURNING *`,
            [req.user.id, exp.id]
        );
        return {...updatedRows[0],voucherBusinessId:voucher.business_id};
    });

    await logAction({ actorUserId: req.user.id, action: 'EXPENSE_APPROVED', entityType: 'EXPENSE', entityId: expense.business_id });
    await generateForEntitySafe('PAYMENT_VOUCHER',expense.voucherBusinessId);
    res.json({ message: 'Expense approved and posted', expense });
}

async function rejectExpense(req, res) {
    const { reason } = req.body;
    const { rows } = await query(
        `UPDATE expenses SET status = 'rejected', rejected_reason = $1
         WHERE business_id = $2 AND company_id = $3 AND status = 'pending_approval'
         RETURNING *`,
        [reason || null, req.params.businessId, req.user.company_id]
    );
    if (rows.length === 0) {
        return res.status(404).json({ error: 'Expense not found or not pending approval' });
    }
    await logAction({ actorUserId: req.user.id, action: 'EXPENSE_REJECTED', entityType: 'EXPENSE', entityId: rows[0].business_id, after: { reason } });
    res.json({ message: 'Expense rejected', expense: rows[0] });
}

async function listExpenses(req, res) {
    const { status } = req.query;
    const { rows } = await query(
        `SELECT e.*, ec.name AS category_name, a.business_id AS account_business_id, a.name AS account_name,cc.name AS cost_center_name
         FROM expenses e
         JOIN expense_categories ec ON ec.id = e.category_id
         JOIN accounts a ON a.id = e.account_id LEFT JOIN cost_centers cc ON cc.id=e.cost_center_id
         WHERE e.company_id = $1 AND ($2::text IS NULL OR e.status = $2)
         ORDER BY e.created_at DESC`,
        [req.user.company_id, status || null]
    );
    res.json({ expenses: rows });
}

module.exports = { createCategory, listCategories, createExpense, approveExpense, rejectExpense, listExpenses };
