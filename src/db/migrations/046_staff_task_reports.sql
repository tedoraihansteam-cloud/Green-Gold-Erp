CREATE TABLE staff_task_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id TEXT NOT NULL UNIQUE,
    company_id UUID NOT NULL REFERENCES companies(id),
    task_id UUID NOT NULL REFERENCES staff_tasks(id) ON DELETE CASCADE,
    submitted_by UUID NOT NULL REFERENCES users(id),
    report_date DATE NOT NULL DEFAULT CURRENT_DATE,
    progress_percent INTEGER NOT NULL CHECK (progress_percent BETWEEN 0 AND 100),
    task_status TEXT NOT NULL CHECK (task_status IN ('assigned','in_progress','blocked','completed')),
    work_summary TEXT NOT NULL,
    blockers TEXT,
    next_actions TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX staff_task_reports_task_date ON staff_task_reports(task_id,created_at DESC);
INSERT INTO numbering_sequences(module_code,prefix_template,padding_length,reset_policy)
VALUES('STAFF_TASK_REPORT','TRP-{YYYYMMDD}-',6,'daily') ON CONFLICT(module_code) DO NOTHING;
