const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { recordAccountTransaction } = require('./accountController');
const { generateForEntitySafe } = require('../services/qrBarcodeService');
const { logAction } = require('../services/auditLogger');

async function listReceivables(req, res) {
    const { customerBusinessId, status } = req.query;
    const { rows } = await query(
        `SELECT cr.*, c.business_id AS customer_business_id, c.name AS customer_name,
                cr.original_amount - cr.paid_amount AS outstanding_amount,
                GREATEST(CURRENT_DATE - cr.due_date, 0) AS days_overdue
         FROM customer_receivables cr JOIN master_customers c ON c.id = cr.customer_id
         WHERE cr.company_id = $1 AND ($2::text IS NULL OR c.business_id = $2)
           AND ($3::text IS NULL OR cr.status = $3)
         ORDER BY cr.due_date, cr.created_at`, [req.user.company_id, customerBusinessId || null, status || null]
    );
    const totalDue = rows.filter((r) => !['paid','cancelled'].includes(r.status)).reduce((sum, r) => sum + Number(r.outstanding_amount), 0);
    res.json({ receivables: rows, totalDue });
}

async function customerBalances(req, res) {
    const { rows } = await query(
        `SELECT c.business_id, c.name, c.phone,
                COALESCE(sum(cr.original_amount - cr.paid_amount) FILTER (WHERE cr.status NOT IN ('paid','cancelled')),0) AS total_due,
                COALESCE(sum(cr.original_amount - cr.paid_amount) FILTER (WHERE cr.status NOT IN ('paid','cancelled') AND cr.due_date < CURRENT_DATE),0) AS overdue
         FROM master_customers c LEFT JOIN customer_receivables cr ON cr.customer_id = c.id
         WHERE c.company_id = $1 AND c.deleted_at IS NULL GROUP BY c.id ORDER BY total_due DESC, c.name`, [req.user.company_id]
    );
    res.json({ customers: rows });
}

async function receivePayment(req, res) {
    const { customerBusinessId, accountBusinessId, amount, paymentDate, reference, notes, receivableId } = req.body;
    if (!customerBusinessId || !accountBusinessId || !amount || Number(amount) <= 0) return res.status(400).json({ error: 'customerBusinessId, accountBusinessId and positive amount are required' });
    const payment = await withTransaction(async (client) => {
        const { rows: customers } = await client.query(`SELECT id FROM master_customers WHERE business_id=$1 AND company_id=$2`, [customerBusinessId, req.user.company_id]);
        const { rows: accounts } = await client.query(`SELECT id FROM accounts WHERE business_id=$1 AND company_id=$2 FOR UPDATE`, [accountBusinessId, req.user.company_id]);
        if (!customers.length || !accounts.length) throw Object.assign(new Error('Customer or receiving account not found'), { statusCode: 404 });
        const paymentBusinessId = await generateNextId('CUSTOMER_PAYMENT');
        const { rows: payments } = await client.query(
            `INSERT INTO customer_payments (business_id,company_id,customer_id,account_id,amount,payment_date,reference,notes,created_by)
             VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7,$8,$9) RETURNING *`,
            [paymentBusinessId,req.user.company_id,customers[0].id,accounts[0].id,amount,paymentDate,reference||null,notes||null,req.user.id]
        );
        const params = [customers[0].id];
        let condition = '';
        if (receivableId) { params.push(receivableId); condition = `AND id = $2`; }
        const { rows: dues } = await client.query(
            `SELECT * FROM customer_receivables WHERE customer_id=$1 ${condition} AND status IN ('unpaid','partial') ORDER BY due_date,created_at FOR UPDATE`, params
        );
        let remaining = Number(amount);
        for (const due of dues) {
            if (remaining <= 0) break;
            const outstanding = Number(due.original_amount) - Number(due.paid_amount);
            const allocated = Math.min(outstanding, remaining);
            await client.query(`INSERT INTO customer_payment_allocations(payment_id,receivable_id,amount) VALUES($1,$2,$3)`, [payments[0].id,due.id,allocated]);
            await client.query(`UPDATE customer_receivables SET paid_amount=paid_amount+$1, status=CASE WHEN paid_amount+$1>=original_amount THEN 'paid' ELSE 'partial' END WHERE id=$2`, [allocated,due.id]);
            const newStatus = allocated >= outstanding ? 'paid' : 'partial';
            if (due.source_type === 'SALES_INVOICE') await client.query(`UPDATE sales_invoices SET payment_status=$1 WHERE business_id=$2`, [newStatus,due.source_id]);
            if (due.source_type === 'COLD_STORAGE_INVOICE') {await client.query(`UPDATE cold_storage_invoices SET payment_status=$1 WHERE business_id=$2`, [newStatus,due.source_id]);await client.query(`UPDATE unified_invoices SET status=$1 WHERE invoice_type='RENT_COLLECTION_INVOICE' AND source_id=$2 AND company_id=$3`,[newStatus,due.source_id,req.user.company_id]);}
            if (due.source_type === 'BATCH_RENT') await client.query(`UPDATE unified_invoices SET status=$1 WHERE source_type='BATCH_RENT' AND source_id=$2 AND company_id=$3`,[newStatus,due.source_id,req.user.company_id]);
            remaining -= allocated;
        }
        if (remaining > 0.0001) throw Object.assign(new Error('Payment is greater than the selected customer outstanding balance'), { statusCode: 409 });
        await recordAccountTransaction(client,{accountId:accounts[0].id,transactionType:'DEPOSIT',amount,referenceType:'CUSTOMER_PAYMENT',referenceId:paymentBusinessId,createdBy:req.user.id,notes});
        const receiptBusinessId=await generateNextId('MONEY_RECEIPT');
        await client.query(`INSERT INTO financial_documents(business_id,company_id,document_type,account_id,customer_id,source_type,source_id,amount,description,created_by) VALUES($1,$2,'MONEY_RECEIPT',$3,$4,'CUSTOMER_PAYMENT',$5,$6,$7,$8)`,[receiptBusinessId,req.user.company_id,accounts[0].id,customers[0].id,paymentBusinessId,amount,notes||`Customer payment ${paymentBusinessId}`,req.user.id]);
        const previousDue=Number((await client.query(`SELECT COALESCE(sum(original_amount-paid_amount),0) due FROM customer_receivables WHERE customer_id=$1 AND status IN('unpaid','partial')`,[customers[0].id])).rows[0].due);
        await client.query(`INSERT INTO unified_invoices(business_id,company_id,customer_id,invoice_type,source_type,source_id,current_total,financial_impact,previous_due_snapshot,total_payable_snapshot,status,review_status,reviewed_by,reviewed_at,approved_by,approved_at)
          VALUES($1,$2,$3,'CUSTOMER_PAYMENT_RECEIPT','CUSTOMER_PAYMENT',$4,$5,$6,$7,$7,'received','approved',$8,now(),$8,now()) ON CONFLICT(business_id) DO NOTHING`,[`FIN-${paymentBusinessId}`,req.user.company_id,customers[0].id,paymentBusinessId,amount,-Number(amount),previousDue,req.user.id]);
        return {...payments[0],receiptBusinessId};
    });
    await generateForEntitySafe('CUSTOMER_PAYMENT', payment.business_id);
    await generateForEntitySafe('MONEY_RECEIPT',payment.receiptBusinessId);
    await logAction({actorUserId:req.user.id,action:'CUSTOMER_PAYMENT_RECEIVED',entityType:'CUSTOMER_PAYMENT',entityId:payment.business_id,after:{amount}});
    res.status(201).json({ payment, moneyReceiptBusinessId:payment.receiptBusinessId });
}

async function reconcilePayment(req,res){const {reference}=req.body;if(!String(reference||'').trim())return res.status(400).json({error:'Bank/cash reconciliation reference is required'});const {rows}=await query(`UPDATE customer_payments SET reconciled_by=$1,reconciled_at=now(),reconciliation_reference=$2 WHERE business_id=$3 AND company_id=$4 AND reconciled_at IS NULL RETURNING *`,[req.user.id,reference,req.params.businessId,req.user.company_id]);if(!rows.length)return res.status(409).json({error:'Payment not found or already reconciled'});await logAction({actorUserId:req.user.id,action:'CUSTOMER_PAYMENT_RECONCILED',entityType:'CUSTOMER_PAYMENT',entityId:req.params.businessId,after:{reference}});res.json({payment:rows[0]});}

module.exports = { listReceivables, customerBalances, receivePayment,reconcilePayment };
