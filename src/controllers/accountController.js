const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { generateForEntity } = require('../services/qrBarcodeService');
const { logAction } = require('../services/auditLogger');
const {createFinancialDocument}=require('../services/financialDocumentService');
const {generateForEntitySafe}=require('../services/qrBarcodeService');
const {postAccountMovementJournal}=require('../services/generalLedgerService');
const {assertPeriodOpen}=require('../services/accountingPeriodService');

/**
 * Records one leg of a financial movement and keeps accounts.current_balance
 * in sync inside the same transaction - same pattern as
 * inventoryController.recordStockMovement, so the ledger and the
 * materialized balance can never drift apart.
 */
async function recordAccountTransaction(client, { accountId, transactionType, amount, referenceType, referenceId, transferGroupId, createdBy, notes, costCenterId, financialClassification }) {
    const company=(await client.query(`SELECT company_id FROM accounts WHERE id=$1`,[accountId])).rows[0];if(!company)throw Object.assign(new Error('Account not found'),{statusCode:404});await assertPeriodOpen(client,company.company_id);
    const direction = ['WITHDRAWAL', 'TRANSFER_OUT'].includes(transactionType) ? -1 : 1;
    const delta = direction * Number(amount);

    const { rows: accountRows } = await client.query(
        `UPDATE accounts SET current_balance = current_balance + $1 WHERE id = $2 RETURNING current_balance`,
        [delta, accountId]
    );
    if (accountRows.length === 0) {
        throw Object.assign(new Error('Account not found'), { statusCode: 404 });
    }
    const newBalance = accountRows[0].current_balance;

    if (newBalance < 0) {
        throw Object.assign(new Error('This would overdraw the account'), { statusCode: 409 });
    }

    const { rows: transactionRows } = await client.query(
        `INSERT INTO account_transactions (account_id, transaction_type, amount, reference_type, reference_id, transfer_group_id, balance_after, created_by, notes,cost_center_id,financial_classification)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,created_at`,
        [accountId,transactionType,amount,referenceType||null,referenceId||null,transferGroupId||null,newBalance,createdBy||null,notes||null,costCenterId||null,financialClassification||({PURCHASE_ORDER_PAYMENT:'INVENTORY_PURCHASE',PAYROLL:'PAYROLL_EXPENSE',BILL_PAYMENT:'OPERATING_EXPENSE',CUSTOMER_PAYMENT:'CUSTOMER_RECEIPT'}[referenceType]||null)]
    );

    // The account ledger is the single source of truth. Any external money-out
    // entry automatically gets a matching, already-posted Expense row. Expense
    // module withdrawals are skipped because their Expense row already exists;
    // transfers use TRANSFER_OUT and are intentionally not business expenses.
    const nonExpenseOutflows = new Set(['EXPENSE','TRANSFER','INVOICE_CANCELLATION','CUSTOMER_REFUND','PAYMENT_REVERSAL','OPENING_BALANCE_REVERSAL','PURCHASE_ORDER_PAYMENT']);
    if (transactionType === 'WITHDRAWAL' && !nonExpenseOutflows.has(referenceType)) {
        const transaction = transactionRows[0];
        const account = (await client.query(`SELECT company_id FROM accounts WHERE id=$1`, [accountId])).rows[0];
        const category = (await client.query(
            `INSERT INTO expense_categories(company_id,code,name) VALUES($1,'AUTO_OUTFLOW','Automatic account deductions') ON CONFLICT(company_id,code) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
            [account.company_id]
        )).rows[0];
        await client.query(
            `INSERT INTO expenses(business_id,company_id,category_id,account_id,amount,description,expense_date,status,created_by,approved_by,approved_at,source_transaction_id,auto_generated,source_reference_type,source_reference_id)
             VALUES($1,$2,$3,$4,$5,$6,CURRENT_DATE,'approved',$7,$7,now(),$8,true,$9,$10)
             ON CONFLICT(source_transaction_id) DO NOTHING`,
            [`EXP-AUTO-${transaction.id}`, account.company_id, category.id, accountId, amount, notes || String(referenceType || 'Automatic account deduction').replaceAll('_',' '), createdBy, transaction.id, referenceType || null, referenceId || null]
        );
    }
    await postAccountMovementJournal(client,{transactionId:transactionRows[0].id,accountId,transactionType,amount,referenceType,referenceId,createdBy,notes,costCenterId,financialClassification});

    return newBalance;
}

async function createAccount(req, res) {
    const { name, accountType, bankName, bankAccountNumber, openingBalance } = req.body;
    if (!name || !accountType) {
        return res.status(400).json({ error: 'name and accountType (cash|bank) are required' });
    }
    if (!['cash', 'bank'].includes(accountType)) {
        return res.status(400).json({ error: "accountType must be 'cash' or 'bank'" });
    }

    const account = await withTransaction(async (client) => {
        const businessId = await generateNextId('ACCOUNT');
        const { rows } = await client.query(
            `INSERT INTO accounts (business_id, company_id, name, account_type, bank_name, bank_account_number)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [businessId, req.user.company_id, name, accountType, bankName || null, bankAccountNumber || null]
        );
        const acct = rows[0];

        if (Number(openingBalance) > 0) {
            await recordAccountTransaction(client, {
                accountId: acct.id, transactionType: 'DEPOSIT', amount: openingBalance,
                referenceType: 'OPENING_BALANCE', createdBy: req.user.id
            });
        }

        const { rows: finalRows } = await client.query(`SELECT * FROM accounts WHERE id = $1`, [acct.id]);
        return finalRows[0];
    });

    await generateForEntity('ACCOUNT', account.business_id);
    await logAction({ actorUserId: req.user.id, action: 'ACCOUNT_CREATED', entityType: 'ACCOUNT', entityId: account.business_id, after: account });
    res.status(201).json({ account });
}

async function listAccounts(req, res) {
    const { rows } = await query(
        `SELECT * FROM accounts WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
        [req.user.company_id]
    );
    res.json({ accounts: rows });
}

async function getAccountStatement(req, res) {
    const { rows: accountRows } = await query(
        `SELECT * FROM accounts WHERE business_id = $1 AND company_id = $2`,
        [req.params.businessId, req.user.company_id]
    );
    if (accountRows.length === 0) return res.status(404).json({ error: 'Account not found' });

    const { rows: txRows } = await query(
        `SELECT * FROM account_transactions WHERE account_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [accountRows[0].id]
    );
    res.json({ account: accountRows[0], transactions: txRows });
}

async function transferFunds(req, res) {
    const { fromAccountBusinessId, toAccountBusinessId, amount, notes } = req.body;
    if (!fromAccountBusinessId || !toAccountBusinessId || !amount || Number(amount) <= 0 || !String(notes||'').trim()) {
        return res.status(400).json({ error: 'Source, destination, positive amount, and transfer remarks are required' });
    }
    if (fromAccountBusinessId === toAccountBusinessId) {
        return res.status(400).json({ error: 'Cannot transfer an account to itself' });
    }

    const workflow=(await query(`SELECT enabled,auto_approve_below FROM workflow_definitions WHERE company_id=$1 AND workflow_key='account_transfer'`,[req.user.company_id])).rows[0];
    const requiresApproval=workflow?.enabled!==false && (workflow?.auto_approve_below===null || Number(amount)>Number(workflow?.auto_approve_below||0));
    if(requiresApproval){
      const result=await withTransaction(async client=>{const from=(await client.query(`SELECT id FROM accounts WHERE business_id=$1 AND company_id=$2`,[fromAccountBusinessId,req.user.company_id])).rows[0],to=(await client.query(`SELECT id FROM accounts WHERE business_id=$1 AND company_id=$2`,[toAccountBusinessId,req.user.company_id])).rows[0];if(!from||!to)throw Object.assign(new Error('One or both accounts not found'),{statusCode:404});const businessId=await generateNextId('ACCOUNT_TRANSFER_REQUEST');return (await client.query(`INSERT INTO account_transfer_requests(business_id,company_id,from_account_id,to_account_id,amount,notes,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[businessId,req.user.company_id,from.id,to.id,amount,String(notes).trim(),req.user.id])).rows[0];});
      await logAction({actorUserId:req.user.id,action:'ACCOUNT_TRANSFER_REQUESTED',entityType:'ACCOUNT_TRANSFER_REQUEST',entityId:result.business_id,after:{fromAccountBusinessId,toAccountBusinessId,amount}});
      return res.status(202).json({message:'Transfer submitted for approval',transferRequest:result,pendingApproval:true});
    }
    const result = await executeTransfer({companyId:req.user.company_id,userId:req.user.id,fromAccountBusinessId,toAccountBusinessId,amount,notes});
    await logAction({actorUserId:req.user.id,action:'FUNDS_TRANSFERRED',entityType:'ACCOUNT_TRANSFER',entityId:result.transferGroupId,after:{fromAccountBusinessId,toAccountBusinessId,amount}});
    await generateForEntitySafe('TRANSFER_VOUCHER',result.voucherBusinessId);
    res.status(201).json({ message: 'Transfer complete', ...result });
}

async function executeTransfer({companyId,userId,fromAccountBusinessId,toAccountBusinessId,amount,notes}){
    return withTransaction(async (client) => {
        const { rows: fromRows } = await client.query(
            `SELECT id FROM accounts WHERE business_id = $1 AND company_id = $2 FOR UPDATE`,
            [fromAccountBusinessId, companyId]
        );
        const { rows: toRows } = await client.query(
            `SELECT id FROM accounts WHERE business_id = $1 AND company_id = $2 FOR UPDATE`,
            [toAccountBusinessId, companyId]
        );
        if (fromRows.length === 0 || toRows.length === 0) {
            throw Object.assign(new Error('One or both accounts not found'), { statusCode: 404 });
        }

        const transferGroupId = uuidv4();
        const fromBalance = await recordAccountTransaction(client, {
            accountId: fromRows[0].id, transactionType: 'TRANSFER_OUT', amount, referenceType: 'TRANSFER',
            transferGroupId, createdBy: userId, notes
        });
        const toBalance = await recordAccountTransaction(client, {
            accountId: toRows[0].id, transactionType: 'TRANSFER_IN', amount, referenceType: 'TRANSFER',
            transferGroupId, createdBy: userId, notes
        });
        const voucher=await createFinancialDocument(client,{companyId,documentType:'TRANSFER_VOUCHER',accountId:fromRows[0].id,sourceType:'ACCOUNT_TRANSFER',sourceId:transferGroupId,amount,description:notes,createdBy:userId});
        return { transferGroupId, fromBalance, toBalance,voucherBusinessId:voucher.business_id };
    });
}

async function listTransferRequests(req,res){const {rows}=await query(`SELECT tr.*,fa.business_id from_account_business_id,fa.name from_account_name,ta.business_id to_account_business_id,ta.name to_account_name,ru.username requested_username,vu.username reviewed_username FROM account_transfer_requests tr JOIN accounts fa ON fa.id=tr.from_account_id JOIN accounts ta ON ta.id=tr.to_account_id JOIN users ru ON ru.id=tr.requested_by LEFT JOIN users vu ON vu.id=tr.reviewed_by WHERE tr.company_id=$1 ORDER BY tr.requested_at DESC LIMIT 300`,[req.user.company_id]);res.json({transferRequests:rows});}

async function reviewTransferRequest(req,res){const {decision,notes}=req.body;if(!['approve','reject'].includes(decision)||!String(notes||'').trim())return res.status(400).json({error:'Decision and review remarks are required'});const request=(await query(`SELECT tr.*,fa.business_id from_business_id,ta.business_id to_business_id FROM account_transfer_requests tr JOIN accounts fa ON fa.id=tr.from_account_id JOIN accounts ta ON ta.id=tr.to_account_id WHERE tr.business_id=$1 AND tr.company_id=$2 AND tr.status='pending_approval'`,[req.params.businessId,req.user.company_id])).rows[0];if(!request)return res.status(409).json({error:'Pending transfer request not found'});if(decision==='reject'){const {rows}=await query(`UPDATE account_transfer_requests SET status='rejected',reviewed_by=$1,reviewed_at=now(),review_notes=$2 WHERE id=$3 AND status='pending_approval' RETURNING *`,[req.user.id,notes,request.id]);await logAction({actorUserId:req.user.id,action:'ACCOUNT_TRANSFER_REJECTED',entityType:'ACCOUNT_TRANSFER_REQUEST',entityId:request.business_id,after:{notes}});return res.json({transferRequest:rows[0]});}const result=await executeTransfer({companyId:req.user.company_id,userId:req.user.id,fromAccountBusinessId:request.from_business_id,toAccountBusinessId:request.to_business_id,amount:request.amount,notes:`${request.notes} | Approval: ${notes}`});const {rows}=await query(`UPDATE account_transfer_requests SET status='completed',reviewed_by=$1,reviewed_at=now(),review_notes=$2,transfer_group_id=$3,voucher_business_id=$4 WHERE id=$5 AND status='pending_approval' RETURNING *`,[req.user.id,notes,result.transferGroupId,result.voucherBusinessId,request.id]);await generateForEntitySafe('TRANSFER_VOUCHER',result.voucherBusinessId);await logAction({actorUserId:req.user.id,action:'ACCOUNT_TRANSFER_APPROVED',entityType:'ACCOUNT_TRANSFER_REQUEST',entityId:request.business_id,after:{notes,voucherBusinessId:result.voucherBusinessId}});res.json({transferRequest:rows[0],...result});
}

/**
 * Balance as of a given date, reconstructed from the ledger rather than
 * just returning current_balance, so this works correctly for past dates
 * too (e.g. "what was our cash position on the 1st of last month").
 */
async function dailyBalanceSheet(req, res) {
    const asOfDate = req.query.date || new Date().toISOString().slice(0, 10);

    const { rows } = await query(
        `SELECT a.business_id, a.name, a.account_type,
                COALESCE(
                    (SELECT balance_after FROM account_transactions
                     WHERE account_id = a.id AND created_at::date <= $2
                     ORDER BY created_at DESC LIMIT 1),
                    0
                ) AS balance
         FROM accounts a
         WHERE a.company_id = $1 AND a.deleted_at IS NULL
         ORDER BY a.account_type, a.name`,
        [req.user.company_id, asOfDate]
    );

    const totalCash = rows.filter((r) => r.account_type === 'cash').reduce((sum, r) => sum + Number(r.balance), 0);
    const totalBank = rows.filter((r) => r.account_type === 'bank').reduce((sum, r) => sum + Number(r.balance), 0);
    const {rows:vouchers}=await query(`SELECT fd.business_id,fd.document_type,fd.source_id,fd.amount,fd.description,fd.created_at,a.business_id account_business_id,a.name account_name,c.name customer_name FROM financial_documents fd LEFT JOIN accounts a ON a.id=fd.account_id LEFT JOIN master_customers c ON c.id=fd.customer_id WHERE fd.company_id=$1 AND fd.created_at::date<=$2 AND fd.document_type IN('MONEY_RECEIPT','PAYMENT_ACCEPTANCE_VOUCHER','TRANSFER_VOUCHER') ORDER BY fd.created_at DESC LIMIT 200`,[req.user.company_id,asOfDate]);
    const {rows:transactions}=await query(`SELECT at.transaction_type,at.amount,at.reference_type,at.reference_id,at.notes,at.created_at,a.business_id account_business_id,a.name account_name FROM account_transactions at JOIN accounts a ON a.id=at.account_id WHERE a.company_id=$1 AND at.created_at::date=$2 ORDER BY at.created_at`,[req.user.company_id,asOfDate]);
    const incoming=transactions.filter(x=>['DEPOSIT','TRANSFER_IN'].includes(x.transaction_type)).reduce((n,x)=>n+Number(x.amount),0),outgoing=transactions.filter(x=>['WITHDRAWAL','TRANSFER_OUT'].includes(x.transaction_type)).reduce((n,x)=>n+Number(x.amount),0);
    const financial=(await query(`SELECT COALESCE((SELECT sum(amount) FROM expenses WHERE company_id=$1 AND status='approved' AND expense_date<=$2),0) expenses,COALESCE((SELECT sum(original_amount-paid_amount) FROM customer_receivables WHERE company_id=$1 AND status IN('unpaid','partial')),0) receivables,COALESCE((SELECT sum(amount) FROM bill_submissions WHERE company_id=$1 AND status IN('approved','accounts_approved','submitted_to_accounts')),0) payables,COALESCE((SELECT sum(pi.net_pay) FROM payroll_items pi JOIN payroll_runs pr ON pr.id=pi.payroll_run_id WHERE pr.company_id=$1 AND pr.status IN('processed','accounts_approved','paid') AND pr.created_at::date<=$2),0) payroll,COALESCE((SELECT sum(current_total) FROM unified_invoices WHERE company_id=$1 AND financial_impact>0 AND status<>'cancelled' AND issued_at::date<=$2),0) billed_income`,[req.user.company_id,asOfDate])).rows[0];
    const [expenseDetails,receivableDetails,payableDetails,payrollDetails]=await Promise.all([
      query(`SELECT e.business_id,e.expense_date,e.amount,e.description,e.paid_to,e.status,ec.name category,a.name account_name FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id JOIN accounts a ON a.id=e.account_id WHERE e.company_id=$1 AND e.expense_date<=$2 ORDER BY e.expense_date DESC,e.created_at DESC LIMIT 300`,[req.user.company_id,asOfDate]),
      query(`SELECT cr.source_type,cr.source_id,cr.description,cr.original_amount,cr.paid_amount,cr.original_amount-cr.paid_amount outstanding_amount,cr.due_date,cr.status,c.name customer_name FROM customer_receivables cr JOIN master_customers c ON c.id=cr.customer_id WHERE cr.company_id=$1 AND cr.status IN('unpaid','partial') ORDER BY cr.due_date,cr.created_at`,[req.user.company_id]),
      query(`SELECT business_id,payee,amount,category,status,bill_date,paid_at FROM bill_submissions WHERE company_id=$1 AND status IN('submitted','approved','accounts_approved','submitted_to_accounts') ORDER BY created_at DESC LIMIT 300`,[req.user.company_id]),
      query(`SELECT pr.business_id,pr.period_month,pr.period_year,pr.status,COALESCE(sum(pi.net_pay),0) total_net_pay,COUNT(pi.id)::int employee_count FROM payroll_runs pr LEFT JOIN payroll_items pi ON pi.payroll_run_id=pr.id WHERE pr.company_id=$1 AND pr.created_at::date<=$2 GROUP BY pr.id ORDER BY pr.period_year DESC,pr.period_month DESC LIMIT 60`,[req.user.company_id,asOfDate])
    ]);

    res.json({
        asOfDate,
        accounts: rows,
        vouchers,
        transactions,
        expenses:expenseDetails.rows,
        receivables:receivableDetails.rows,
        payables:payableDetails.rows,
        payroll:payrollDetails.rows,
        financialSummary:{incoming,outgoing,expenses:Number(financial.expenses),receivables:Number(financial.receivables),payables:Number(financial.payables),payroll:Number(financial.payroll),billedIncome:Number(financial.billed_income),netCashMovement:incoming-outgoing},
        totals: { cash: totalCash, bank: totalBank, grandTotal: totalCash + totalBank }
    });
}

async function pendingFinancialActions(req,res){const company=req.user.company_id;const results=await Promise.all([
 query(`SELECT business_id,'EXPENSE' action_type,description subject,amount,status,created_at FROM expenses WHERE company_id=$1 AND status='pending_approval'`,[company]),
 query(`SELECT business_id,'BILL' action_type,COALESCE(description,payee) subject,amount,status,created_at FROM bill_submissions WHERE company_id=$1 AND status IN('submitted','submitted_to_accounts','approved','accounts_approved','paid')`,[company]),
 query(`SELECT business_id,'PAYROLL' action_type,('Payroll '||period_month||'/'||period_year) subject,COALESCE((SELECT sum(net_pay) FROM payroll_items WHERE payroll_run_id=pr.id),0) amount,status,created_at FROM payroll_runs pr WHERE company_id=$1 AND status IN('submitted_to_accounts','accounts_approved')`,[company]),
 query(`SELECT business_id,'ACCOUNT_TRANSFER' action_type,notes subject,amount,status,requested_at created_at FROM account_transfer_requests WHERE company_id=$1 AND status='pending_approval'`,[company]),
 query(`SELECT cr.source_id business_id,'OVERDUE_RECEIVABLE' action_type,COALESCE(cr.description,c.name) subject,cr.original_amount-cr.paid_amount amount,cr.status,cr.created_at FROM customer_receivables cr JOIN master_customers c ON c.id=cr.customer_id WHERE cr.company_id=$1 AND cr.status IN('unpaid','partial') AND cr.due_date<CURRENT_DATE`,[company]),
 query(`SELECT business_id,'CUSTOMER_COMMITMENT' action_type,commitment_notes subject,commitment_amount amount,status,created_at FROM rent_collection_invoices WHERE company_id=$1 AND commitment_date<=CURRENT_DATE AND remaining_due>0`,[company]),
 query(`SELECT business_id,'PAYMENT_REQUEST' action_type,subject,amount,status,created_at FROM portal_requests WHERE company_id=$1 AND requires_accounts=true AND status IN('submitted','accounts_pending')`,[company])]);const actions=results.flatMap(x=>x.rows).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));res.json({actions,summary:actions.reduce((o,x)=>{o[x.action_type]=(o[x.action_type]||0)+1;return o;},{})});}

module.exports = { createAccount, listAccounts, getAccountStatement, transferFunds, listTransferRequests, reviewTransferRequest, dailyBalanceSheet, pendingFinancialActions, recordAccountTransaction };
