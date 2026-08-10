-- Make every previously generated batch-rent receivable visible in Invoice Center.
INSERT INTO unified_invoices(
 business_id,company_id,customer_id,invoice_type,source_type,source_id,
 current_total,financial_impact,previous_due_snapshot,total_payable_snapshot,status,issued_at
)
SELECT
 'FIN-RENT-'||split_part(cr.source_id,':',1)||'-'||replace(split_part(cr.source_id,':',2),'-',''),
 cr.company_id,cr.customer_id,'RENT_COLLECTION_INVOICE','BATCH_RENT',cr.source_id,
 cr.original_amount,cr.original_amount,
 COALESCE((SELECT sum(old.original_amount-old.paid_amount) FROM customer_receivables old
           WHERE old.customer_id=cr.customer_id AND old.created_at<cr.created_at AND old.status IN('unpaid','partial')),0),
 cr.original_amount+COALESCE((SELECT sum(old.original_amount-old.paid_amount) FROM customer_receivables old
           WHERE old.customer_id=cr.customer_id AND old.created_at<cr.created_at AND old.status IN('unpaid','partial')),0),
 CASE WHEN cr.status='paid' THEN 'paid' ELSE 'issued' END,cr.created_at
FROM customer_receivables cr
WHERE cr.source_type='BATCH_RENT'
ON CONFLICT(business_id) DO NOTHING;

-- Repair any older customer payment that predates automatic account posting.
INSERT INTO account_transactions(account_id,transaction_type,amount,reference_type,reference_id,balance_after,created_by,notes,created_at)
SELECT cp.account_id,'DEPOSIT',cp.amount,'CUSTOMER_PAYMENT',cp.business_id,
       a.current_balance+sum(cp.amount) OVER(PARTITION BY cp.account_id ORDER BY cp.created_at,cp.id),
       cp.created_by,'Reconciled customer payment',cp.created_at
FROM customer_payments cp JOIN accounts a ON a.id=cp.account_id
WHERE NOT EXISTS(SELECT 1 FROM account_transactions at WHERE at.reference_type='CUSTOMER_PAYMENT' AND at.reference_id=cp.business_id);

UPDATE accounts a SET current_balance=COALESCE((SELECT balance_after FROM account_transactions at WHERE at.account_id=a.id ORDER BY at.created_at DESC,at.id DESC LIMIT 1),a.current_balance);
