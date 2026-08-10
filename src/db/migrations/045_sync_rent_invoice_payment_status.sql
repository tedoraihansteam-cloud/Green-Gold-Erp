UPDATE unified_invoices ui SET status=CASE
 WHEN cr.status='paid' THEN 'paid'
 WHEN cr.status='partial' THEN 'partial'
 ELSE ui.status END
FROM customer_receivables cr
WHERE ui.invoice_type='RENT_COLLECTION_INVOICE'
 AND ((ui.source_type='BATCH_RENT' AND cr.source_type='BATCH_RENT' AND cr.source_id=ui.source_id)
   OR (ui.source_type='COLD_STORAGE_INVOICES' AND cr.source_type='COLD_STORAGE_INVOICE' AND cr.source_id=ui.source_id));
