-- Green Gold ERP - Phase 3: Manufacturing / Machine Room
--
-- Design notes:
--   * Per spec section 14 ("24/7 operation... digital checklists instead
--     of paper notebooks"), this covers: machine master records, shift
--     logs (which double as inspection checklist + running hours +
--     handover notes, kept as one table since they're logged together in
--     practice), breakdown/emergency incidents (unified into one table -
--     a fire alarm and a compressor breakdown follow the same
--     report -> resolve workflow, they just differ by incident_type), and
--     a preventive maintenance schedule.
--   * Incidents can reference a specific machine or none (e.g. "door open
--     alarm" or "power failure" may not be about one piece of equipment).

CREATE TABLE machines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     TEXT NOT NULL UNIQUE,   -- MCH-000001
    company_id      UUID NOT NULL REFERENCES companies(id),
    warehouse_id    UUID REFERENCES warehouses(id),
    name            TEXT NOT NULL,
    machine_type    TEXT,             -- compressor, generator, boiler, processing_line, etc. - free text, not an enum
    model           TEXT,
    installed_date  DATE,
    status          TEXT NOT NULL DEFAULT 'running', -- running, stopped, maintenance, breakdown
    total_running_hours NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE machine_shift_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id          UUID NOT NULL REFERENCES machines(id),
    shift_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    shift_type          TEXT NOT NULL,   -- morning, evening, night - configurable, not enforced as enum
    status_at_log       TEXT NOT NULL,   -- running, stopped, idle
    running_hours_this_shift NUMERIC(6,2) NOT NULL DEFAULT 0,
    handover_notes       TEXT,           -- what the next shift needs to know
    logged_by             UUID NOT NULL REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shift_logs_machine ON machine_shift_logs (machine_id, shift_date);

CREATE TABLE machine_incidents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         TEXT NOT NULL UNIQUE,   -- INC-20260801-000001
    company_id          UUID NOT NULL REFERENCES companies(id),
    machine_id          UUID REFERENCES machines(id), -- nullable: some incidents aren't machine-specific
    incident_type        TEXT NOT NULL,   -- BREAKDOWN, POWER_FAILURE, TEMPERATURE_RISE, GENERATOR_FAILURE,
                                            -- COMPRESSOR_TRIP, LEAKAGE, FIRE, VIBRATION, DOOR_ALARM, OTHER
    severity              TEXT NOT NULL DEFAULT 'medium', -- low, medium, high, critical
    description            TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'open', -- open, in_progress, resolved
    reported_by              UUID NOT NULL REFERENCES users(id),
    reported_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_by                 UUID REFERENCES users(id),
    resolved_at                  TIMESTAMPTZ,
    resolution_notes               TEXT
);

CREATE INDEX idx_machine_incidents_status ON machine_incidents (company_id, status);

CREATE TABLE machine_maintenance_schedule (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id          UUID NOT NULL REFERENCES machines(id),
    maintenance_type     TEXT NOT NULL DEFAULT 'preventive', -- preventive, corrective
    scheduled_date         DATE NOT NULL,
    completed_date           DATE,
    status                    TEXT NOT NULL DEFAULT 'scheduled', -- scheduled, completed, overdue
    performed_by                UUID REFERENCES users(id),
    notes                         TEXT,
    created_by                     UUID NOT NULL REFERENCES users(id),
    created_at                       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_maintenance_machine ON machine_maintenance_schedule (machine_id, scheduled_date);
