ALTER TABLE rental_policies ADD COLUMN IF NOT EXISTS billing_basis TEXT NOT NULL DEFAULT 'rolling';
ALTER TABLE rental_policies ADD COLUMN IF NOT EXISTS operational_year_start_month INTEGER NOT NULL DEFAULT 6;
ALTER TABLE rental_policies ADD CONSTRAINT rental_policy_billing_basis_check CHECK (billing_basis IN ('rolling','operational_year'));
ALTER TABLE product_batches ADD COLUMN IF NOT EXISTS billing_basis TEXT NOT NULL DEFAULT 'rolling';

CREATE UNIQUE INDEX IF NOT EXISTS uq_batch_rent_period
 ON customer_receivables(company_id,source_type,source_id)
 WHERE source_type='BATCH_RENT';
