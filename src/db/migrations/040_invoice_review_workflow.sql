ALTER TABLE unified_invoices
 ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'pending_review',
 ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
 ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS review_notes TEXT,
 ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
 ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS invoice_workflow_events(
 id BIGSERIAL PRIMARY KEY,
 invoice_id UUID NOT NULL REFERENCES unified_invoices(id) ON DELETE CASCADE,
 action TEXT NOT NULL,
 from_status TEXT,
 to_status TEXT NOT NULL,
 notes TEXT,
 actor_user_id UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_workflow_events_invoice ON invoice_workflow_events(invoice_id,created_at);
