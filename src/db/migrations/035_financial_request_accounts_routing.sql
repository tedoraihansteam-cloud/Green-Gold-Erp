-- Route every payment-related general request through Accounts while preserving
-- the originating department's approval where applicable.
ALTER TABLE portal_requests
    ADD COLUMN IF NOT EXISTS requires_accounts BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS department_review_status TEXT,
    ADD COLUMN IF NOT EXISTS department_reviewed_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS department_reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS department_review_notes TEXT,
    ADD COLUMN IF NOT EXISTS accounts_review_status TEXT,
    ADD COLUMN IF NOT EXISTS accounts_reviewed_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS accounts_reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS accounts_review_notes TEXT;

UPDATE portal_requests
SET requires_accounts = true
WHERE amount IS NOT NULL AND amount > 0;

UPDATE portal_requests
SET requires_accounts = true
WHERE request_type = 'ALLOWANCE';

UPDATE portal_requests
SET department = 'ACCOUNTS'
WHERE requires_accounts = true AND status IN ('draft','submitted');

CREATE INDEX IF NOT EXISTS idx_portal_requests_accounts_queue
    ON portal_requests(company_id,status,requires_accounts,created_at DESC);
