ALTER TABLE bulk_import_jobs
    ADD COLUMN detected_document_type TEXT,
    ADD COLUMN extraction_result JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN routing_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN source_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN submission_options JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN submission_result JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE bulk_import_postings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES bulk_import_jobs(id) ON DELETE CASCADE,
    record_type TEXT NOT NULL,
    external_key TEXT NOT NULL,
    target_entity_type TEXT,
    target_entity_id TEXT,
    status TEXT NOT NULL DEFAULT 'posted',
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(job_id, record_type, external_key)
);

CREATE INDEX idx_bulk_import_postings_job ON bulk_import_postings(job_id, record_type);
