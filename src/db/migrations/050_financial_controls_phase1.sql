CREATE TABLE IF NOT EXISTS account_transfer_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id TEXT NOT NULL UNIQUE,
 company_id UUID NOT NULL REFERENCES companies(id),
 from_account_id UUID NOT NULL REFERENCES accounts(id),
 to_account_id UUID NOT NULL REFERENCES accounts(id),
 amount NUMERIC(14,2) NOT NULL CHECK(amount>0),
 notes TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending_approval' CHECK(status IN('pending_approval','approved','rejected','completed')),
 requested_by UUID NOT NULL REFERENCES users(id),
 requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 reviewed_by UUID REFERENCES users(id),
 reviewed_at TIMESTAMPTZ,
 review_notes TEXT,
 transfer_group_id UUID,
 voucher_business_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_company_status ON account_transfer_requests(company_id,status,requested_at DESC);

INSERT INTO numbering_sequences(module_code,prefix_template,padding_length,reset_policy)
VALUES('ACCOUNT_TRANSFER_REQUEST','ATR-{YYYYMMDD}-',6,'daily') ON CONFLICT(module_code) DO NOTHING;

INSERT INTO workflow_definitions(company_id,workflow_key,display_name,auto_approve_below,approval_steps)
SELECT id,'expense_approval','Expense approval',5000,'[{"name":"Accounts expense approval","department":"accounts","permission":"ACCOUNTS_APPROVE","required":true,"allowReject":true}]'::jsonb FROM companies
ON CONFLICT(company_id,workflow_key) DO NOTHING;

INSERT INTO workflow_definitions(company_id,workflow_key,display_name,auto_approve_below,approval_steps)
SELECT id,'account_transfer','Account-to-account transfer',5000,'[{"name":"Accounts transfer approval","department":"accounts","permission":"ACCOUNTS_APPROVE","required":true,"allowReject":true}]'::jsonb FROM companies
ON CONFLICT(company_id,workflow_key) DO NOTHING;
