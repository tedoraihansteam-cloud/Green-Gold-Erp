CREATE TABLE IF NOT EXISTS data_correction_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id TEXT NOT NULL UNIQUE,
 company_id UUID NOT NULL REFERENCES companies(id), entity_type TEXT NOT NULL, entity_business_id TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN('EDIT','DELETE','RESTORE','CANCEL','REVERSE')),
 proposed_changes JSONB NOT NULL DEFAULT '{}', reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN('submitted','approved','rejected','applied','failed','module_action_required')),
 requested_by UUID NOT NULL REFERENCES users(id), requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 reviewed_by UUID REFERENCES users(id), reviewed_at TIMESTAMPTZ, review_notes TEXT,
 applied_by UUID REFERENCES users(id), applied_at TIMESTAMPTZ, before_data JSONB, after_data JSONB, failure_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_data_corrections_company_status ON data_correction_requests(company_id,status,requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_corrections_entity ON data_correction_requests(company_id,entity_type,entity_business_id);
INSERT INTO numbering_sequences(module_code,prefix_template,padding_length,reset_policy)
VALUES('DATA_CORRECTION','DCR-{YYYYMMDD}-',6,'daily') ON CONFLICT(module_code) DO NOTHING;
