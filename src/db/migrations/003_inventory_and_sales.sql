-- Green Gold ERP - Phase 2: Inventory + Sales/Invoicing
--
-- Design notes:
--   * stock_ledger is an append-only record of every stock movement
--     (a true audit trail for inventory, separate from audit_logs which
--     covers admin/business actions generally).
--   * stock_balances is a materialized "current quantity" per
--     product+warehouse, updated transactionally alongside every
--     stock_ledger insert, so reads don't need to sum the whole ledger.
--   * Selling stock and issuing an invoice happen in one transaction:
--     insufficient stock blocks the invoice rather than allowing negative
--     inventory.

CREATE TABLE warehouses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     TEXT NOT NULL UNIQUE,   -- WH-000001
    company_id      UUID NOT NULL REFERENCES companies(id),
    branch_id       UUID REFERENCES branches(id),
    name            TEXT NOT NULL,
    location_notes  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     TEXT NOT NULL UNIQUE,   -- PRD-000001
    company_id      UUID NOT NULL REFERENCES companies(id),
    name            TEXT NOT NULL,
    sku             TEXT,
    category        TEXT,
    unit            TEXT NOT NULL DEFAULT 'pcs', -- kg, ton, bag, pcs, litre, etc. - configurable, not an enum
    unit_price      NUMERIC(14,2) NOT NULL DEFAULT 0,
    reorder_level   NUMERIC(14,2) NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE stock_balances (
    product_id      UUID NOT NULL REFERENCES products(id),
    warehouse_id    UUID NOT NULL REFERENCES warehouses(id),
    quantity        NUMERIC(14,3) NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, warehouse_id)
);

CREATE TABLE stock_ledger (
    id              BIGSERIAL PRIMARY KEY,
    product_id      UUID NOT NULL REFERENCES products(id),
    warehouse_id    UUID NOT NULL REFERENCES warehouses(id),
    movement_type   TEXT NOT NULL,  -- IN, OUT, ADJUSTMENT, TRANSFER_IN, TRANSFER_OUT
    quantity        NUMERIC(14,3) NOT NULL, -- always positive; movement_type gives direction
    reference_type  TEXT,            -- PURCHASE, SALE, OPENING_BALANCE, ADJUSTMENT, TRANSFER
    reference_id    TEXT,            -- e.g. the invoice business_id
    balance_after   NUMERIC(14,3) NOT NULL,
    created_by      UUID REFERENCES users(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_ledger_product_warehouse ON stock_ledger (product_id, warehouse_id);

-- ============================================================
-- Sales invoicing
-- ============================================================

CREATE TABLE sales_invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     TEXT NOT NULL UNIQUE,   -- INV-20260801-000001
    company_id      UUID NOT NULL REFERENCES companies(id),
    customer_id     UUID NOT NULL REFERENCES master_customers(id),
    warehouse_id    UUID NOT NULL REFERENCES warehouses(id),
    status          TEXT NOT NULL DEFAULT 'issued', -- issued, cancelled
    subtotal        NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount        NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax             NUMERIC(14,2) NOT NULL DEFAULT 0,
    total           NUMERIC(14,2) NOT NULL DEFAULT 0,
    notes           TEXT,
    issued_by       UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at    TIMESTAMPTZ,
    cancelled_by    UUID REFERENCES users(id),
    cancel_reason   TEXT
);

CREATE TABLE sales_invoice_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id      UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
    product_id      UUID NOT NULL REFERENCES products(id),
    quantity        NUMERIC(14,3) NOT NULL,
    unit_price      NUMERIC(14,2) NOT NULL,
    line_total      NUMERIC(14,2) NOT NULL
);

CREATE INDEX idx_sales_invoice_items_invoice ON sales_invoice_items (invoice_id);
