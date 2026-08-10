-- Register historical customer payments as approved receipt invoices.
INSERT INTO unified_invoices(
 business_id,company_id,customer_id,invoice_type,source_type,source_id,current_total,
 financial_impact,previous_due_snapshot,total_payable_snapshot,status,review_status,
 reviewed_by,reviewed_at,approved_by,approved_at,issued_at
)
SELECT 'FIN-'||cp.business_id,cp.company_id,cp.customer_id,'CUSTOMER_PAYMENT_RECEIPT',
       'CUSTOMER_PAYMENT',cp.business_id,cp.amount,-cp.amount,
       COALESCE((SELECT sum(cr.original_amount-cr.paid_amount) FROM customer_receivables cr
                 WHERE cr.customer_id=cp.customer_id AND cr.status IN('unpaid','partial')),0),
       COALESCE((SELECT sum(cr.original_amount-cr.paid_amount) FROM customer_receivables cr
                 WHERE cr.customer_id=cp.customer_id AND cr.status IN('unpaid','partial')),0),
       'received','approved',cp.created_by,cp.created_at,cp.created_by,cp.created_at,cp.created_at
FROM customer_payments cp
ON CONFLICT(business_id) DO NOTHING;
