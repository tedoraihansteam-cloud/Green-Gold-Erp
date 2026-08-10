CREATE TABLE staff_attendance_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID NOT NULL REFERENCES companies(id),
    user_id             UUID NOT NULL REFERENCES users(id),
    attendance_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    clock_in_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    clock_out_at        TIMESTAMPTZ,
    attendance_mode     TEXT NOT NULL DEFAULT 'office'
        CHECK (attendance_mode IN ('office','field','remote','device','manual')),
    clock_in_ip         TEXT,
    clock_out_ip        TEXT,
    latitude            NUMERIC(10,7),
    longitude           NUMERIC(10,7),
    location_address    TEXT,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (clock_out_at IS NULL OR clock_out_at >= clock_in_at)
);

CREATE UNIQUE INDEX staff_attendance_one_open_session
    ON staff_attendance_sessions(user_id) WHERE clock_out_at IS NULL;
CREATE INDEX staff_attendance_company_date
    ON staff_attendance_sessions(company_id, attendance_date);
CREATE INDEX staff_attendance_user_date
    ON staff_attendance_sessions(user_id, attendance_date DESC);

CREATE TABLE staff_tasks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         TEXT NOT NULL UNIQUE,
    company_id          UUID NOT NULL REFERENCES companies(id),
    title               TEXT NOT NULL,
    description         TEXT,
    assignee_user_id    UUID NOT NULL REFERENCES users(id),
    assigned_by         UUID NOT NULL REFERENCES users(id),
    priority            TEXT NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low','normal','high','urgent')),
    status              TEXT NOT NULL DEFAULT 'assigned'
        CHECK (status IN ('assigned','in_progress','blocked','completed','cancelled')),
    progress_percent    INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
    due_date            DATE,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX staff_tasks_assignee_status
    ON staff_tasks(assignee_user_id, status, due_date);
CREATE INDEX staff_tasks_company_status
    ON staff_tasks(company_id, status, due_date);

CREATE TABLE staff_task_time_entries (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id              UUID NOT NULL REFERENCES companies(id),
    task_id                 UUID NOT NULL REFERENCES staff_tasks(id) ON DELETE CASCADE,
    user_id                 UUID NOT NULL REFERENCES users(id),
    attendance_session_id   UUID NOT NULL REFERENCES staff_attendance_sessions(id),
    started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    stopped_at              TIMESTAMPTZ,
    ip_address              TEXT,
    latitude                NUMERIC(10,7),
    longitude               NUMERIC(10,7),
    location_address        TEXT,
    notes                   TEXT,
    CHECK (stopped_at IS NULL OR stopped_at >= started_at)
);

CREATE UNIQUE INDEX staff_task_time_one_open_entry
    ON staff_task_time_entries(user_id) WHERE stopped_at IS NULL;
CREATE INDEX staff_task_time_task
    ON staff_task_time_entries(task_id, started_at DESC);

INSERT INTO numbering_sequences(module_code,prefix_template,padding_length,reset_policy)
VALUES('STAFF_TASK','TSK-{YYYYMMDD}-',6,'daily')
ON CONFLICT(module_code) DO NOTHING;
