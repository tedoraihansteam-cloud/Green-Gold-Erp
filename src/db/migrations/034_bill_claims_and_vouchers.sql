-- Expand bill submission into a general expense claim and payable workflow.
ALTER TABLE bill_submissions
    ADD COLUMN IF NOT EXISTS claimant_type TEXT NOT NULL DEFAULT 'external',
    ADD COLUMN IF NOT EXISTS claimant_user_id UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES master_employees(id),
    ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id),
    ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id),
    ADD COLUMN IF NOT EXISTS expense_start_date DATE,
    ADD COLUMN IF NOT EXISTS expense_end_date DATE,
    ADD COLUMN IF NOT EXISTS preferred_payment_method TEXT,
    ADD COLUMN IF NOT EXISTS expense_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS returned_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS approved_voucher_business_id TEXT,
    ADD COLUMN IF NOT EXISTS payment_voucher_business_id TEXT,
    ADD COLUMN IF NOT EXISTS acceptance_voucher_business_id TEXT,
    ADD COLUMN IF NOT EXISTS payment_method TEXT,
    ADD COLUMN IF NOT EXISTS payment_reference TEXT,
    ADD COLUMN IF NOT EXISTS payment_date DATE,
    ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS accepted_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS accepted_by_name TEXT,
    ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS acceptance_notes TEXT;

CREATE TABLE IF NOT EXISTS bill_workflow_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES bill_submissions(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    notes TEXT,
    actor_user_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bill_workflow_events_bill ON bill_workflow_events(bill_id,created_at);

INSERT INTO numbering_sequences(module_code,prefix_template,padding_length,reset_policy) VALUES
 ('APPROVED_PAYABLE_VOUCHER','APV-{YYYYMMDD}-',6,'daily'),
 ('PAYMENT_ACCEPTANCE_VOUCHER','PAV-{YYYYMMDD}-',6,'daily')
ON CONFLICT (module_code) DO NOTHING;
