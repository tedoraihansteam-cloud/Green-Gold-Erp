-- Green Gold ERP - Phase 3: Logistics / Delivery
--
-- Design notes:
--   * A delivery can optionally reference the sales invoice it's
--     fulfilling (most common case) and/or the gate pass that authorized
--     the goods to physically leave - reusing what Sales and Security
--     already built rather than duplicating "what's being delivered"
--     data a third time.
--   * Vehicle status (available/on_delivery/maintenance) is simple
--     enough to just set directly on dispatch/complete rather than
--     needing its own ledger like stock or cash.

CREATE TABLE delivery_vehicles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     TEXT NOT NULL UNIQUE,   -- VEH-000001
    company_id      UUID NOT NULL REFERENCES companies(id),
    vehicle_number  TEXT NOT NULL,
    vehicle_type    TEXT,             -- truck, van, pickup, etc.
    capacity_unit   TEXT,
    capacity_value  NUMERIC(12,2),
    driver_name     TEXT,
    driver_phone    TEXT,
    status          TEXT NOT NULL DEFAULT 'available', -- available, on_delivery, maintenance
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE (company_id, vehicle_number)
);

CREATE TABLE deliveries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         TEXT NOT NULL UNIQUE,   -- DEL-20260801-000001
    company_id          UUID NOT NULL REFERENCES companies(id),
    customer_id         UUID NOT NULL REFERENCES master_customers(id),
    invoice_id           UUID REFERENCES sales_invoices(id),
    gate_pass_id           UUID REFERENCES gate_passes(id),
    vehicle_id               UUID REFERENCES delivery_vehicles(id),
    delivery_address           TEXT,
    scheduled_date               DATE,
    status                        TEXT NOT NULL DEFAULT 'scheduled', -- scheduled, in_transit, delivered, failed, cancelled
    dispatched_by                   UUID REFERENCES users(id),
    dispatched_at                     TIMESTAMPTZ,
    delivered_at                        TIMESTAMPTZ,
    proof_notes                           TEXT,        -- received-by name, condition notes, etc.
    failure_reason                          TEXT,
    created_by                                UUID NOT NULL REFERENCES users(id),
    created_at                                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deliveries_status ON deliveries (company_id, status);
