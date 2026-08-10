CREATE TABLE goods_receipts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id TEXT NOT NULL UNIQUE,
 company_id UUID NOT NULL REFERENCES companies(id), batch_id UUID NOT NULL UNIQUE REFERENCES product_batches(id),
 customer_id UUID REFERENCES master_customers(id), contract_id UUID REFERENCES storage_contracts(id), warehouse_id UUID NOT NULL REFERENCES warehouses(id),
 received_quantity NUMERIC(14,3) NOT NULL, rent_rate NUMERIC(14,2) NOT NULL DEFAULT 0, billing_cycle TEXT NOT NULL DEFAULT 'monthly',
 labor_amount NUMERIC(14,2) NOT NULL DEFAULT 0, service_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
 condition_notes TEXT, acknowledgement_name TEXT, created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bill_submissions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id TEXT NOT NULL UNIQUE,
 company_id UUID NOT NULL REFERENCES companies(id), submitter_user_id UUID NOT NULL REFERENCES users(id),
 vendor_id UUID REFERENCES master_vendors(id), bill_number TEXT, bill_date DATE NOT NULL DEFAULT CURRENT_DATE,
 category TEXT NOT NULL, payee TEXT NOT NULL, amount NUMERIC(14,2) NOT NULL CHECK(amount>0), description TEXT,
 related_type TEXT, related_id TEXT, status TEXT NOT NULL DEFAULT 'draft', submitted_at TIMESTAMPTZ,
 reviewed_by UUID REFERENCES users(id), reviewed_at TIMESTAMPTZ, review_notes TEXT,
 paid_account_id UUID REFERENCES accounts(id), paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bill_submissions_status ON bill_submissions(company_id,status,created_at);

ALTER TABLE portal_requests ADD COLUMN details JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE portal_requests ADD COLUMN requested_date DATE;

CREATE TABLE financial_documents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id TEXT NOT NULL UNIQUE,
 company_id UUID NOT NULL REFERENCES companies(id), document_type TEXT NOT NULL,
 account_id UUID REFERENCES accounts(id), customer_id UUID REFERENCES master_customers(id), vendor_id UUID REFERENCES master_vendors(id),
 source_type TEXT NOT NULL, source_id TEXT NOT NULL, amount NUMERIC(14,2) NOT NULL CHECK(amount>=0),
 description TEXT, created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(document_type,source_type,source_id)
);

CREATE TABLE stock_release_documents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id TEXT NOT NULL UNIQUE,
 company_id UUID NOT NULL REFERENCES companies(id), customer_id UUID REFERENCES master_customers(id), batch_id UUID NOT NULL REFERENCES product_batches(id),
 quantity NUMERIC(14,3) NOT NULL CHECK(quantity>0), previous_quantity NUMERIC(14,3) NOT NULL, remaining_quantity NUMERIC(14,3) NOT NULL,
 delivery_id UUID REFERENCES deliveries(id), gate_pass_id UUID REFERENCES gate_passes(id), rental_due_through DATE,
 labor_amount NUMERIC(14,2) NOT NULL DEFAULT 0, service_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
 created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO numbering_sequences(module_code,prefix_template,padding_length,reset_policy) VALUES
 ('GOODS_RECEIPT','GRN-{YYYYMMDD}-',6,'daily'),('BILL_SUBMISSION','BILL-{YYYYMMDD}-',6,'daily'),
 ('MONEY_RECEIPT','MR-{YYYYMMDD}-',6,'daily'),('PAYMENT_VOUCHER','PV-{YYYYMMDD}-',6,'daily'),
 ('TRANSFER_VOUCHER','TV-{YYYYMMDD}-',6,'daily'),('STOCK_RELEASE','SR-{YYYYMMDD}-',6,'daily');
