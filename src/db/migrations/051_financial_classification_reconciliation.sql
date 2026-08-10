CREATE TABLE IF NOT EXISTS cost_centers(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
 business_id TEXT NOT NULL UNIQUE, code TEXT NOT NULL, name TEXT NOT NULL,
 department_id UUID REFERENCES departments(id), branch_id UUID REFERENCES branches(id), active BOOLEAN NOT NULL DEFAULT true,
 created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(company_id,code)
);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id), ADD COLUMN IF NOT EXISTS financial_classification TEXT DEFAULT 'OPERATING_EXPENSE';
ALTER TABLE account_transactions ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id), ADD COLUMN IF NOT EXISTS financial_classification TEXT;
ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS voucher_business_id TEXT, ADD COLUMN IF NOT EXISTS accepted_by UUID REFERENCES users(id), ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS acceptance_notes TEXT, ADD COLUMN IF NOT EXISTS reconciled_by UUID REFERENCES users(id), ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS reconciliation_reference TEXT;
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS reconciled_by UUID REFERENCES users(id), ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS reconciliation_reference TEXT;

CREATE TABLE IF NOT EXISTS financial_reversal_requests(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id TEXT NOT NULL UNIQUE, company_id UUID NOT NULL REFERENCES companies(id),
 account_transaction_id BIGINT NOT NULL REFERENCES account_transactions(id), reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending_approval' CHECK(status IN('pending_approval','approved','rejected','completed')),
 requested_by UUID NOT NULL REFERENCES users(id), requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), reviewed_by UUID REFERENCES users(id), reviewed_at TIMESTAMPTZ, review_notes TEXT,
 reversal_transaction_id BIGINT REFERENCES account_transactions(id), voucher_business_id TEXT
);
CREATE TABLE IF NOT EXISTS financial_refunds(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id TEXT NOT NULL UNIQUE, company_id UUID NOT NULL REFERENCES companies(id),
 refund_type TEXT NOT NULL CHECK(refund_type IN('CUSTOMER_REFUND','SUPPLIER_REFUND','EMPLOYEE_REFUND')),
 account_id UUID NOT NULL REFERENCES accounts(id), customer_id UUID REFERENCES master_customers(id), vendor_id UUID REFERENCES master_vendors(id), employee_id UUID REFERENCES master_employees(id),
 amount NUMERIC(14,2) NOT NULL CHECK(amount>0), reason TEXT NOT NULL, reference TEXT, status TEXT NOT NULL DEFAULT 'completed',
 created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), voucher_business_id TEXT
);
INSERT INTO numbering_sequences(module_code,prefix_template,padding_length,reset_policy) VALUES
 ('COST_CENTER','CC-{YYYY}-',4,'yearly'),('FINANCIAL_REVERSAL','REV-{YYYYMMDD}-',6,'daily'),('FINANCIAL_REFUND','RFD-{YYYYMMDD}-',6,'daily')
ON CONFLICT(module_code) DO NOTHING;
INSERT INTO workflow_definitions(company_id,workflow_key,display_name,approval_steps)
SELECT id,'financial_reversal','Financial reversal','[{"name":"Accounts reversal review","department":"accounts","permission":"ACCOUNTS_APPROVE","required":true,"allowReject":true}]'::jsonb FROM companies ON CONFLICT(company_id,workflow_key) DO NOTHING;
