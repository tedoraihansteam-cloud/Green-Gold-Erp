-- Link sales to the account that received the payment. Existing invoices stay
-- nullable because inventing a historical cash/bank destination would corrupt
-- the ledger; every new invoice created by the portal supplies one.
ALTER TABLE sales_invoices
    ADD COLUMN payment_account_id UUID REFERENCES accounts(id);

CREATE INDEX idx_sales_invoices_payment_account
    ON sales_invoices (payment_account_id);

-- An invoice may post exactly one receipt and one cancellation reversal.
CREATE UNIQUE INDEX uq_account_tx_invoice_receipt
    ON account_transactions (reference_type, reference_id)
    WHERE reference_type IN ('INVOICE_PAYMENT', 'INVOICE_CANCELLATION');

-- Existing Super Admin roles must receive permissions added by later modules.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code LIKE 'REPORTS_%'
WHERE r.name = 'Super Admin'
ON CONFLICT DO NOTHING;

