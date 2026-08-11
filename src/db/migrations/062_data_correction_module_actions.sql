ALTER TABLE data_correction_requests
    ADD COLUMN IF NOT EXISTS effective_operation TEXT,
    ADD COLUMN IF NOT EXISTS dependency_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS module_action_notes TEXT,
    ADD COLUMN IF NOT EXISTS module_action_result JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE goods_receipts
    ADD COLUMN IF NOT EXISTS correction_status TEXT NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_data_corrections_module_action
    ON data_correction_requests(company_id,status,reviewed_at DESC)
    WHERE status='module_action_required';
