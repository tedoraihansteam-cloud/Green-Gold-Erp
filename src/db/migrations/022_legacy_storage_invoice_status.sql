UPDATE cold_storage_invoices csi
SET payment_status = 'legacy'
WHERE NOT EXISTS (
    SELECT 1 FROM customer_receivables cr
    WHERE cr.source_type = 'COLD_STORAGE_INVOICE' AND cr.source_id = csi.business_id
);
