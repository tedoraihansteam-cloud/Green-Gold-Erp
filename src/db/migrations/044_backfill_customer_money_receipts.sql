INSERT INTO financial_documents(business_id,company_id,document_type,account_id,customer_id,source_type,source_id,amount,description,created_by,created_at)
SELECT 'MR-'||cp.business_id,cp.company_id,'MONEY_RECEIPT',cp.account_id,cp.customer_id,
       'CUSTOMER_PAYMENT',cp.business_id,cp.amount,'Customer payment receipt '||cp.business_id,cp.created_by,cp.created_at
FROM customer_payments cp
WHERE NOT EXISTS(SELECT 1 FROM financial_documents fd WHERE fd.document_type='MONEY_RECEIPT' AND fd.source_type='CUSTOMER_PAYMENT' AND fd.source_id=cp.business_id)
ON CONFLICT(business_id) DO NOTHING;
