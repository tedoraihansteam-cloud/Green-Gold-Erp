CREATE TABLE rent_collection_invoices (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),business_id TEXT NOT NULL UNIQUE,company_id UUID NOT NULL REFERENCES companies(id),customer_id UUID NOT NULL REFERENCES master_customers(id),
 invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,selected_due_total NUMERIC(16,2) NOT NULL DEFAULT 0,new_charge_total NUMERIC(16,2) NOT NULL DEFAULT 0,
 discount NUMERIC(16,2) NOT NULL DEFAULT 0,tax NUMERIC(16,2) NOT NULL DEFAULT 0,total_payable NUMERIC(16,2) NOT NULL,amount_received NUMERIC(16,2) NOT NULL DEFAULT 0,
 remaining_due NUMERIC(16,2) NOT NULL DEFAULT 0,payment_mode TEXT NOT NULL DEFAULT 'commitment',payment_method TEXT,account_id UUID REFERENCES accounts(id),payment_reference TEXT,
 commitment_amount NUMERIC(16,2),commitment_date DATE,commitment_notes TEXT,status TEXT NOT NULL DEFAULT 'issued',created_by UUID NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE rent_collection_invoice_lines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),invoice_id UUID NOT NULL REFERENCES rent_collection_invoices(id) ON DELETE CASCADE,receivable_id UUID REFERENCES customer_receivables(id),
 line_type TEXT NOT NULL,description TEXT NOT NULL,amount NUMERIC(16,2) NOT NULL,allocated_payment NUMERIC(16,2) NOT NULL DEFAULT 0
);
CREATE INDEX rent_collection_customer_date ON rent_collection_invoices(customer_id,invoice_date DESC);
INSERT INTO numbering_sequences(module_code,prefix_template,padding_length,reset_policy) VALUES('RENT_COLLECTION','RCI-{YYYYMMDD}-',6,'daily') ON CONFLICT(module_code) DO NOTHING;
