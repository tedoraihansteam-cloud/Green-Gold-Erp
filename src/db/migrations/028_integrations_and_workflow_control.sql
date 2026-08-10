CREATE TABLE api_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'none',
    credential_secret TEXT,
    header_name TEXT,
    webhook_url TEXT,
    health_path TEXT,
    timeout_seconds INTEGER NOT NULL DEFAULT 8 CHECK (timeout_seconds BETWEEN 2 AND 30),
    enabled BOOLEAN NOT NULL DEFAULT true,
    last_test_status TEXT,
    last_test_message TEXT,
    last_tested_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(company_id, name)
);

CREATE TABLE workflow_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    workflow_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    require_attachment BOOLEAN NOT NULL DEFAULT false,
    auto_approve_below NUMERIC(14,2),
    escalation_hours INTEGER CHECK (escalation_hours IS NULL OR escalation_hours BETWEEN 1 AND 720),
    notify_requester BOOLEAN NOT NULL DEFAULT true,
    notify_channels JSONB NOT NULL DEFAULT '["in-app"]',
    approval_steps JSONB NOT NULL DEFAULT '[]',
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(company_id, workflow_key)
);

INSERT INTO workflow_definitions(company_id,workflow_key,display_name,require_attachment,approval_steps)
SELECT id,'bill_submission','Bill submission',true,'[{"name":"Accounts review","department":"accounts","permission":"ACCOUNTS_APPROVE","required":true,"allowReject":true}]'::jsonb FROM companies
ON CONFLICT DO NOTHING;
INSERT INTO workflow_definitions(company_id,workflow_key,display_name,approval_steps)
SELECT id,'payroll_pay_order','Payroll pay order','[{"name":"HR pay-order submission","department":"hr","permission":"HR_APPROVE","required":true,"allowReject":true},{"name":"Accounts approval","department":"accounts","permission":"ACCOUNTS_APPROVE","required":true,"allowReject":true}]'::jsonb FROM companies
ON CONFLICT DO NOTHING;
INSERT INTO workflow_definitions(company_id,workflow_key,display_name,approval_steps)
SELECT id,'stock_transfer','Stock transfer and delivery','[{"name":"Inventory authorization","department":"inventory","permission":"INVENTORY_APPROVE","required":true,"allowReject":true}]'::jsonb FROM companies
ON CONFLICT DO NOTHING;
INSERT INTO workflow_definitions(company_id,workflow_key,display_name,approval_steps)
SELECT id,'account_registration','Customer, vendor, and staff registration','[{"name":"Super admin approval","department":"management","permission":"USER_MANAGEMENT_APPROVE","required":true,"allowReject":true}]'::jsonb FROM companies
ON CONFLICT DO NOTHING;
