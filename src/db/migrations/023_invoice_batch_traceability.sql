ALTER TABLE sales_invoice_items ADD COLUMN batch_id UUID REFERENCES product_batches(id);
CREATE INDEX idx_sales_invoice_items_batch ON sales_invoice_items(batch_id);
