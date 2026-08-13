CREATE TABLE IF NOT EXISTS bulk_import_reference_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES bulk_import_jobs(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  section_type TEXT NOT NULL,
  section_title TEXT,
  sheet_name TEXT,
  source_row TEXT NOT NULL,
  disposition TEXT NOT NULL DEFAULT 'historical_reference' CHECK(disposition IN('historical_reference','current_operational','scheduled_future','excluded')),
  effective_date DATE,
  record_data JSONB NOT NULL,
  posting_status TEXT NOT NULL DEFAULT 'reference' CHECK(posting_status IN('reference','pending','posted','failed','excluded')),
  posted_entity_type TEXT,
  posted_entity_id TEXT,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_id,section_id,source_row)
);
CREATE INDEX IF NOT EXISTS idx_import_reference_company ON bulk_import_reference_rows(company_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_reference_search ON bulk_import_reference_rows USING gin(record_data jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_import_reference_schedule ON bulk_import_reference_rows(company_id,effective_date) WHERE disposition='scheduled_future' AND posting_status='pending';
