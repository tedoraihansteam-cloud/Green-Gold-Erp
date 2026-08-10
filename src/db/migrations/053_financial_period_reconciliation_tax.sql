CREATE TABLE IF NOT EXISTS accounting_periods(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id UUID NOT NULL REFERENCES companies(id),period_start DATE NOT NULL,period_end DATE NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','closed','locked')),closed_by UUID REFERENCES users(id),closed_at TIMESTAMPTZ,reopened_by UUID REFERENCES users(id),reopened_at TIMESTAMPTZ,remarks TEXT,
 UNIQUE(company_id,period_start,period_end),CHECK(period_end>=period_start)
);
CREATE TABLE IF NOT EXISTS bank_reconciliations(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),business_id TEXT NOT NULL UNIQUE,company_id UUID NOT NULL REFERENCES companies(id),account_id UUID NOT NULL REFERENCES accounts(id),
 statement_date DATE NOT NULL,statement_balance NUMERIC(16,2) NOT NULL,ledger_balance NUMERIC(16,2) NOT NULL,difference NUMERIC(16,2) NOT NULL,
 reference TEXT NOT NULL,remarks TEXT,status TEXT NOT NULL DEFAULT 'reconciled',reconciled_by UUID REFERENCES users(id),reconciled_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(account_id,statement_date)
);
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'cleared',ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ,ADD COLUMN IF NOT EXISTS bounced_by UUID REFERENCES users(id),ADD COLUMN IF NOT EXISTS bounced_reason TEXT,ADD COLUMN IF NOT EXISTS reversal_voucher_business_id TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(7,4) NOT NULL DEFAULT 0,ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(16,2) NOT NULL DEFAULT 0,ADD COLUMN IF NOT EXISTS tax_reference TEXT;
ALTER TABLE bill_submissions ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(7,4) NOT NULL DEFAULT 0,ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(16,2) NOT NULL DEFAULT 0,ADD COLUMN IF NOT EXISTS tax_reference TEXT;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS adjustment_type TEXT,ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS journal_adjustment_requests(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),business_id TEXT NOT NULL UNIQUE,company_id UUID NOT NULL REFERENCES companies(id),journal_date DATE NOT NULL,description TEXT NOT NULL,lines JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending_approval' CHECK(status IN('pending_approval','approved','rejected','posted')),requested_by UUID NOT NULL REFERENCES users(id),requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),reviewed_by UUID REFERENCES users(id),reviewed_at TIMESTAMPTZ,review_notes TEXT,journal_entry_id UUID REFERENCES journal_entries(id)
);
INSERT INTO numbering_sequences(module_code,prefix_template,padding_length,reset_policy) VALUES('BANK_RECONCILIATION','BRC-{YYYYMMDD}-',6,'daily'),('JOURNAL_ADJUSTMENT','JAD-{YYYYMMDD}-',6,'daily'),('YEAR_END_CLOSE','YEC-{YYYY}-',4,'yearly') ON CONFLICT(module_code) DO NOTHING;
INSERT INTO workflow_definitions(company_id,workflow_key,display_name,approval_steps) SELECT id,'journal_adjustment','Manual journal adjustment','[{"name":"Accounts adjustment approval","department":"accounts","permission":"ACCOUNTS_APPROVE","required":true,"allowReject":true}]'::jsonb FROM companies ON CONFLICT(company_id,workflow_key) DO NOTHING;
