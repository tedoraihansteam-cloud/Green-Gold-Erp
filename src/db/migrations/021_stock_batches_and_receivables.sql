-- Physical batch/lot traceability.
CREATE TABLE product_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id TEXT NOT NULL UNIQUE,
    company_id UUID NOT NULL REFERENCES companies(id),
    product_id UUID NOT NULL REFERENCES products(id),
    owner_customer_id UUID REFERENCES master_customers(id),
    lot_number TEXT,
    source_reference TEXT,
    manufactured_date DATE,
    expiry_date DATE,
    received_quantity NUMERIC(14,3) NOT NULL CHECK (received_quantity > 0),
    available_quantity NUMERIC(14,3) NOT NULL CHECK (available_quantity >= 0),
    status TEXT NOT NULL DEFAULT 'available',
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_batches_product ON product_batches (product_id, status);
CREATE INDEX idx_product_batches_owner ON product_batches (owner_customer_id, status);

CREATE TABLE location_allowed_categories (
    location_id UUID NOT NULL REFERENCES storage_locations(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    PRIMARY KEY (location_id, category)
);

CREATE TABLE batch_location_balances (
    batch_id UUID NOT NULL REFERENCES product_batches(id),
    location_id UUID NOT NULL REFERENCES storage_locations(id),
    quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (batch_id, location_id)
);
CREATE INDEX idx_batch_locations_location ON batch_location_balances (location_id) WHERE quantity > 0;

CREATE TABLE batch_movements (
    id BIGSERIAL PRIMARY KEY,
    batch_id UUID NOT NULL REFERENCES product_batches(id),
    from_location_id UUID REFERENCES storage_locations(id),
    to_location_id UUID REFERENCES storage_locations(id),
    movement_type TEXT NOT NULL,
    quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    reference_type TEXT,
    reference_id TEXT,
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Customer charges, receivables and actual collections.
CREATE TABLE customer_charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id TEXT NOT NULL UNIQUE,
    company_id UUID NOT NULL REFERENCES companies(id),
    customer_id UUID NOT NULL REFERENCES master_customers(id),
    contract_id UUID REFERENCES storage_contracts(id),
    delivery_id UUID REFERENCES deliveries(id),
    charge_type TEXT NOT NULL,
    description TEXT,
    quantity NUMERIC(14,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    rate NUMERIC(14,2) NOT NULL CHECK (rate >= 0),
    amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    charge_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'posted',
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer_receivables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    customer_id UUID NOT NULL REFERENCES master_customers(id),
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    description TEXT,
    original_amount NUMERIC(14,2) NOT NULL CHECK (original_amount >= 0),
    paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    due_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'unpaid',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at TIMESTAMPTZ,
    UNIQUE (source_type, source_id)
);
CREATE INDEX idx_customer_receivables_due ON customer_receivables (customer_id, status, due_date);

CREATE TABLE customer_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id TEXT NOT NULL UNIQUE,
    company_id UUID NOT NULL REFERENCES companies(id),
    customer_id UUID NOT NULL REFERENCES master_customers(id),
    account_id UUID NOT NULL REFERENCES accounts(id),
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    reference TEXT,
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer_payment_allocations (
    payment_id UUID NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
    receivable_id UUID NOT NULL REFERENCES customer_receivables(id),
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    PRIMARY KEY (payment_id, receivable_id)
);

ALTER TABLE master_customers ADD COLUMN credit_period_days INTEGER NOT NULL DEFAULT 0 CHECK (credit_period_days >= 0);
ALTER TABLE sales_invoices ADD COLUMN due_date DATE;
ALTER TABLE sales_invoices ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE cold_storage_invoices ADD COLUMN due_date DATE;
ALTER TABLE cold_storage_invoices ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid';

INSERT INTO numbering_sequences (module_code, prefix_template, padding_length, reset_policy) VALUES
    ('PRODUCT_BATCH', 'BAT-{YYYYMMDD}-', 6, 'daily'),
    ('CUSTOMER_CHARGE', 'CHG-{YYYYMMDD}-', 6, 'daily'),
    ('CUSTOMER_PAYMENT', 'PAY-{YYYYMMDD}-', 6, 'daily');
