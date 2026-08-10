-- Rental-aware receiving, unit identities, penalties, and general approval workflows.
ALTER TABLE products ADD COLUMN monthly_rent_per_unit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (monthly_rent_per_unit >= 0);

ALTER TABLE master_customers ADD COLUMN entity_kind TEXT NOT NULL DEFAULT 'individual';
ALTER TABLE master_customers ADD COLUMN default_rent_per_unit NUMERIC(14,2) CHECK (default_rent_per_unit >= 0);
ALTER TABLE master_customers ADD COLUMN penalty_percent NUMERIC(7,3) NOT NULL DEFAULT 0 CHECK (penalty_percent >= 0);
ALTER TABLE master_customers ADD COLUMN penalty_grace_days INTEGER NOT NULL DEFAULT 0 CHECK (penalty_grace_days >= 0);

ALTER TABLE product_batches ADD COLUMN receiving_warehouse_id UUID REFERENCES warehouses(id);
ALTER TABLE product_batches ADD COLUMN rental_policy_id UUID REFERENCES rental_policies(id);
ALTER TABLE product_batches ADD COLUMN contract_id UUID REFERENCES storage_contracts(id);
ALTER TABLE product_batches ADD COLUMN rent_per_unit_per_cycle NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (rent_per_unit_per_cycle >= 0);
ALTER TABLE product_batches ADD COLUMN billing_cycle TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE product_batches ADD COLUMN received_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE product_batches ADD COLUMN located_at TIMESTAMPTZ;
ALTER TABLE product_batches ADD COLUMN last_rent_billed_through DATE;

CREATE TABLE product_batch_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES product_batches(id) ON DELETE CASCADE,
    unit_number INTEGER NOT NULL CHECK (unit_number > 0),
    business_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'stored',
    location_id UUID REFERENCES storage_locations(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(batch_id, unit_number)
);
CREATE INDEX idx_product_batch_units_batch ON product_batch_units(batch_id, status);

CREATE TABLE portal_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id TEXT NOT NULL UNIQUE,
    company_id UUID NOT NULL REFERENCES companies(id),
    requester_user_id UUID NOT NULL REFERENCES users(id),
    request_type TEXT NOT NULL,
    department TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT,
    amount NUMERIC(14,2),
    status TEXT NOT NULL DEFAULT 'draft',
    submitted_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app_settings (
    company_id UUID NOT NULL REFERENCES companies(id),
    setting_key TEXT NOT NULL,
    setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_secret BOOLEAN NOT NULL DEFAULT false,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(company_id, setting_key)
);

ALTER TABLE payroll_runs ADD COLUMN submitted_by UUID REFERENCES users(id);
ALTER TABLE payroll_runs ADD COLUMN submitted_at TIMESTAMPTZ;
ALTER TABLE payroll_runs ADD COLUMN accounts_approved_by UUID REFERENCES users(id);
ALTER TABLE payroll_runs ADD COLUMN accounts_approved_at TIMESTAMPTZ;
ALTER TABLE payroll_runs ADD COLUMN approval_notes TEXT;

INSERT INTO numbering_sequences(module_code,prefix_template,padding_length,reset_policy) VALUES
 ('PORTAL_REQUEST','REQ-{YYYYMMDD}-',6,'daily');
