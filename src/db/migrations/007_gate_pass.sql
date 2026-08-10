-- Green Gold ERP - Phase 3: Security / Gate Pass
--
-- Per architecture rule #15: security verifies and releases, it does not
-- re-enter business data. Gate passes get created FROM an already-approved
-- transaction (e.g. a sales invoice, for outward goods) wherever possible;
-- manual creation stays available for visitors, contractors, and machine
-- movement that don't have a source transaction.

CREATE TABLE gate_passes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id             TEXT NOT NULL UNIQUE,   -- GP-20260801-000001
    company_id              UUID NOT NULL REFERENCES companies(id),
    pass_type               TEXT NOT NULL,   -- OUTWARD_GOODS, INWARD_GOODS, VISITOR, CONTRACTOR, MACHINE_MOVEMENT, EMPLOYEE_ASSET
    source_reference_type   TEXT,             -- SALES_INVOICE, PURCHASE_ORDER, MANUAL
    source_reference_id     TEXT,             -- business_id of the source document, if any
    description             TEXT NOT NULL,    -- what/who is moving, e.g. "30 bags BRRI Rice 28" or "Visitor: John Doe"
    vehicle_number           TEXT,
    contact_name             TEXT,             -- driver / visitor / contractor name
    contact_phone            TEXT,
    status                   TEXT NOT NULL DEFAULT 'issued', -- issued, exited, cancelled
    issued_by                UUID NOT NULL REFERENCES users(id),
    exit_confirmed_by         UUID REFERENCES users(id),
    exit_confirmed_at         TIMESTAMPTZ,
    cancelled_by              UUID REFERENCES users(id),
    cancelled_at              TIMESTAMPTZ,
    cancel_reason             TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gate_passes_status ON gate_passes (company_id, status);
