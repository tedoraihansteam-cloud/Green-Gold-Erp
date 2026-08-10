-- Green Gold ERP - Phase 3: Cold Storage
--
-- Design notes:
--   * storage_locations is a self-referencing tree under an existing
--     warehouse (the "building"), so floor -> zone -> room -> rack ->
--     shelf -> bin all use the same table instead of six near-identical
--     ones. location_type says which level a row represents.
--   * rental_policies are configurable billing rule profiles (rule #10:
--     "configurable rental rule engine") - unit type, rate, minimum
--     billing period, billing cycle, tax - rather than any of this being
--     hard-coded per contract.
--   * The signature rule from the spec ("actual stay: 1 hour, minimum
--     charge: 1 month, invoice: 1 month rental") is implemented in
--     coldStorageController.generateBilling, not in the schema - the
--     schema just stores what generateBilling needs to compute it.

CREATE TABLE storage_locations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         TEXT NOT NULL UNIQUE,   -- SL-000001
    company_id          UUID NOT NULL REFERENCES companies(id),
    warehouse_id        UUID NOT NULL REFERENCES warehouses(id),
    parent_location_id  UUID REFERENCES storage_locations(id),
    location_type       TEXT NOT NULL,   -- FLOOR, ZONE, ROOM, RACK, SHELF, BIN
    name                TEXT NOT NULL,
    temperature_zone    TEXT,             -- e.g. "-18C Frozen", "2-8C Chilled", "Ambient"
    capacity_unit       TEXT,             -- pallet, ton, cbm, sqft - matches the rental policy's unit_type
    capacity_value       NUMERIC(14,2),
    status               TEXT NOT NULL DEFAULT 'active',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at             TIMESTAMPTZ
);

CREATE INDEX idx_storage_locations_parent ON storage_locations (parent_location_id);
CREATE INDEX idx_storage_locations_warehouse ON storage_locations (warehouse_id);

CREATE TABLE rental_policies (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id             TEXT NOT NULL UNIQUE,   -- RP-000001
    company_id              UUID NOT NULL REFERENCES companies(id),
    name                    TEXT NOT NULL,
    unit_type               TEXT NOT NULL,   -- pallet, crate, rack, ton, sqft, cbm, room
    rate_per_unit_per_cycle NUMERIC(14,2) NOT NULL,
    billing_cycle           TEXT NOT NULL,   -- daily, weekly, monthly, yearly
    min_billing_cycles      INTEGER NOT NULL DEFAULT 1,  -- the "minimum 1 month" rule
    grace_period_days       INTEGER NOT NULL DEFAULT 0,
    tax_percent             NUMERIC(5,2) NOT NULL DEFAULT 0,
    status                  TEXT NOT NULL DEFAULT 'active',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE storage_contracts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         TEXT NOT NULL UNIQUE,   -- CSC-2026-000001
    company_id          UUID NOT NULL REFERENCES companies(id),
    customer_id         UUID NOT NULL REFERENCES master_customers(id),
    storage_location_id UUID NOT NULL REFERENCES storage_locations(id),
    rental_policy_id    UUID NOT NULL REFERENCES rental_policies(id),
    unit_quantity       NUMERIC(14,2) NOT NULL,   -- e.g. 5 pallets, 2 tons
    goods_description   TEXT,
    start_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date            DATE,
    last_billed_through  DATE,             -- billing continues from here on the next run
    status               TEXT NOT NULL DEFAULT 'active', -- active, closed, cancelled
    created_by            UUID NOT NULL REFERENCES users(id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at              TIMESTAMPTZ,
    closed_by               UUID REFERENCES users(id)
);

CREATE INDEX idx_storage_contracts_status ON storage_contracts (company_id, status);

CREATE TABLE cold_storage_invoices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         TEXT NOT NULL UNIQUE,   -- CSI-20260801-000001
    company_id          UUID NOT NULL REFERENCES companies(id),
    contract_id         UUID NOT NULL REFERENCES storage_contracts(id),
    billing_period_start DATE NOT NULL,
    billing_period_end   DATE NOT NULL,
    billed_cycles         INTEGER NOT NULL,
    unit_quantity          NUMERIC(14,2) NOT NULL,
    rate_used               NUMERIC(14,2) NOT NULL,
    minimum_applied          BOOLEAN NOT NULL DEFAULT false, -- true when the minimum-billing rule kicked in
    subtotal                 NUMERIC(14,2) NOT NULL,
    tax_amount                NUMERIC(14,2) NOT NULL,
    total                      NUMERIC(14,2) NOT NULL,
    status                     TEXT NOT NULL DEFAULT 'issued', -- issued, cancelled
    created_by                  UUID NOT NULL REFERENCES users(id),
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cold_storage_invoices_contract ON cold_storage_invoices (contract_id);
