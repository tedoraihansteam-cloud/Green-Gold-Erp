ALTER TABLE bulk_import_jobs
    ADD COLUMN IF NOT EXISTS approval_step_index INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS approval_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS submitted_for_approval_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS submitted_for_approval_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS final_approved_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS final_approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approval_notes TEXT;

CREATE TABLE IF NOT EXISTS bulk_import_approval_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES bulk_import_jobs(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    step_name TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN('submitted','approved','rejected','returned','routed')),
    notes TEXT,
    actor_user_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bulk_import_approval_events_job
    ON bulk_import_approval_events(job_id,created_at);

INSERT INTO workflow_definitions(company_id,workflow_key,display_name,approval_steps)
SELECT id,'universal_data_import','Universal data import',
       '[{"name":"Data verification","department":"administration","permission":"USER_MANAGEMENT_APPROVE","required":true,"allowReject":true},{"name":"Department authorization","department":"operations","permission":"USER_MANAGEMENT_APPROVE","required":true,"allowReject":true},{"name":"Management authorization","department":"management","permission":"USER_MANAGEMENT_APPROVE","required":true,"allowReject":true}]'::jsonb
FROM companies
ON CONFLICT(company_id,workflow_key) DO NOTHING;
