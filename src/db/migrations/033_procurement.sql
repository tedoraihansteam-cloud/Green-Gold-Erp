-- Procurement / purchase orders, adapted from v1.5.2 for the v1.5.1 schema.
-- Added as migration 033 so every existing v1.5.1 migration remains intact.

CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id TEXT NOT NULL UNIQUE,
    company_id UUID NOT NULL REFERENCES companies(id),
    vendor_id UUID NOT NULL REFERENCES master_vendors(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    status TEXT NOT NULL DEFAULT 'issued'
        CHECK (status IN ('issued', 'partially_received', 'received', 'cancelled')),
    subtotal NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    tax NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
    total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
    payment_status TEXT NOT NULL DEFAULT 'unpaid'
        CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid')),
    amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES users(id),
    cancel_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_company_status
    ON purchase_orders (company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor
    ON purchase_orders (vendor_id);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity_ordered NUMERIC(14,3) NOT NULL CHECK (quantity_ordered > 0),
    quantity_received NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
    unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
    line_total NUMERIC(14,2) NOT NULL CHECK (line_total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items (purchase_order_id);

CREATE TABLE IF NOT EXISTS purchase_order_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
    received_by UUID NOT NULL REFERENCES users(id),
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivery_note_ref TEXT,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_po_receipts_po
    ON purchase_order_receipts (purchase_order_id, received_at DESC);

CREATE TABLE IF NOT EXISTS purchase_order_receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES purchase_order_receipts(id) ON DELETE CASCADE,
    po_item_id UUID NOT NULL REFERENCES purchase_order_items(id),
    quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS purchase_order_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
    account_id UUID NOT NULL REFERENCES accounts(id),
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    payment_method TEXT NOT NULL DEFAULT 'cash'
        CHECK (payment_method IN ('cash', 'bank', 'mobile_banking', 'cheque')),
    reference TEXT,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    paid_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_payments_po
    ON purchase_order_payments (purchase_order_id, created_at DESC);
