CREATE TABLE IF NOT EXISTS company_operation_controls (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  inactivity_minutes INTEGER NOT NULL DEFAULT 15 CHECK(inactivity_minutes BETWEEN 1 AND 1440),
  attendance_start TIME NOT NULL DEFAULT '09:00',
  attendance_end TIME NOT NULL DEFAULT '18:00',
  attendance_grace_minutes INTEGER NOT NULL DEFAULT 0 CHECK(attendance_grace_minutes BETWEEN 0 AND 240),
  attendance_timezone TEXT NOT NULL DEFAULT 'Asia/Dhaka',
  attendance_working_days JSONB NOT NULL DEFAULT '[1,2,3,4,5,6]'::jsonb,
  finance_live_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO company_operation_controls(company_id)
SELECT id FROM companies ON CONFLICT(company_id) DO NOTHING;

ALTER TABLE staff_attendance_sessions
  ADD COLUMN IF NOT EXISTS is_counted BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS attendance_status TEXT NOT NULL DEFAULT 'counted',
  ADD COLUMN IF NOT EXISTS policy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS regularized_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS regularized_at TIMESTAMPTZ;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(16,2) NOT NULL DEFAULT 0;
UPDATE accounts a SET opening_balance=COALESCE((SELECT amount FROM account_transactions t WHERE t.account_id=a.id AND t.reference_type='OPENING_BALANCE' ORDER BY t.created_at LIMIT 1),0) WHERE opening_balance=0;

CREATE INDEX IF NOT EXISTS idx_bulk_import_reference_search
ON bulk_import_jobs USING gin (extraction_result jsonb_path_ops);
