CREATE TABLE IF NOT EXISTS unified_invoices (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id TEXT NOT NULL UNIQUE,
 company_id UUID NOT NULL REFERENCES companies(id), customer_id UUID REFERENCES master_customers(id),
 invoice_type TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
 current_total NUMERIC(16,2) NOT NULL DEFAULT 0, financial_impact NUMERIC(16,2) NOT NULL DEFAULT 0,
 previous_due_snapshot NUMERIC(16,2) NOT NULL DEFAULT 0, total_payable_snapshot NUMERIC(16,2) NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'issued', issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(company_id,source_type,source_id)
);
CREATE INDEX IF NOT EXISTS idx_unified_invoices_customer ON unified_invoices(customer_id,issued_at DESC);

CREATE OR REPLACE FUNCTION register_central_invoice() RETURNS trigger AS $$
DECLARE cid UUID; invtype TEXT; invstatus TEXT:='issued'; amount NUMERIC:=0; impact NUMERIC:=0; prev NUMERIC:=0;
BEGIN
 IF TG_TABLE_NAME='sales_invoices' THEN cid:=NEW.customer_id;invtype:='SALES_INVOICE';invstatus:=NEW.status;amount:=NEW.total;impact:=NEW.total;
 ELSIF TG_TABLE_NAME='cold_storage_invoices' THEN SELECT customer_id INTO cid FROM storage_contracts WHERE id=NEW.contract_id;invtype:='RENT_COLLECTION_INVOICE';invstatus:=NEW.status;amount:=NEW.total;impact:=NEW.total;
 ELSIF TG_TABLE_NAME='goods_receipts' THEN cid:=NEW.customer_id;invtype:='GOODS_RECEIVING_INVOICE';invstatus:='received';amount:=NEW.labor_amount+NEW.service_amount;impact:=amount;
 ELSIF TG_TABLE_NAME='deliveries' THEN cid:=NEW.customer_id;invtype:='DELIVERY_INVOICE';invstatus:=NEW.status;SELECT COALESCE(total,0) INTO amount FROM sales_invoices WHERE id=NEW.invoice_id;impact:=0;
 ELSIF TG_TABLE_NAME='storage_contracts' THEN cid:=NEW.customer_id;invtype:='RENTAL_CONTRACT';invstatus:=NEW.status;SELECT NEW.unit_quantity*rate_per_unit_per_cycle*min_billing_cycles INTO amount FROM rental_policies WHERE id=NEW.rental_policy_id;impact:=0;
 END IF;
 IF cid IS NOT NULL THEN SELECT COALESCE(sum(original_amount-paid_amount),0) INTO prev FROM customer_receivables WHERE customer_id=cid AND status IN('unpaid','partial'); END IF;
 INSERT INTO unified_invoices(business_id,company_id,customer_id,invoice_type,source_type,source_id,current_total,financial_impact,previous_due_snapshot,total_payable_snapshot,status,issued_at)
 VALUES('FIN-'||NEW.business_id,NEW.company_id,cid,invtype,upper(TG_TABLE_NAME),NEW.business_id,COALESCE(amount,0),COALESCE(impact,0),prev,prev+COALESCE(impact,0),invstatus,NEW.created_at)
 ON CONFLICT(company_id,source_type,source_id) DO NOTHING;
 RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_central_invoice ON sales_invoices; CREATE TRIGGER trg_sales_central_invoice AFTER INSERT ON sales_invoices FOR EACH ROW EXECUTE FUNCTION register_central_invoice();
DROP TRIGGER IF EXISTS trg_rent_central_invoice ON cold_storage_invoices; CREATE TRIGGER trg_rent_central_invoice AFTER INSERT ON cold_storage_invoices FOR EACH ROW EXECUTE FUNCTION register_central_invoice();
DROP TRIGGER IF EXISTS trg_receiving_central_invoice ON goods_receipts; CREATE TRIGGER trg_receiving_central_invoice AFTER INSERT ON goods_receipts FOR EACH ROW EXECUTE FUNCTION register_central_invoice();
DROP TRIGGER IF EXISTS trg_delivery_central_invoice ON deliveries; CREATE TRIGGER trg_delivery_central_invoice AFTER INSERT ON deliveries FOR EACH ROW EXECUTE FUNCTION register_central_invoice();
DROP TRIGGER IF EXISTS trg_contract_central_invoice ON storage_contracts; CREATE TRIGGER trg_contract_central_invoice AFTER INSERT ON storage_contracts FOR EACH ROW EXECUTE FUNCTION register_central_invoice();

INSERT INTO unified_invoices(business_id,company_id,customer_id,invoice_type,source_type,source_id,current_total,financial_impact,previous_due_snapshot,total_payable_snapshot,status,issued_at)
SELECT 'FIN-'||si.business_id,si.company_id,si.customer_id,'SALES_INVOICE','SALES_INVOICES',si.business_id,si.total,si.total,COALESCE((SELECT sum(cr.original_amount-cr.paid_amount) FROM customer_receivables cr WHERE cr.customer_id=si.customer_id AND cr.source_id<>si.business_id AND cr.status IN('unpaid','partial')),0),si.total+COALESCE((SELECT sum(cr.original_amount-cr.paid_amount) FROM customer_receivables cr WHERE cr.customer_id=si.customer_id AND cr.source_id<>si.business_id AND cr.status IN('unpaid','partial')),0),si.status,si.created_at FROM sales_invoices si ON CONFLICT DO NOTHING;
INSERT INTO unified_invoices(business_id,company_id,customer_id,invoice_type,source_type,source_id,current_total,financial_impact,previous_due_snapshot,total_payable_snapshot,status,issued_at)
SELECT 'FIN-'||csi.business_id,csi.company_id,sc.customer_id,'RENT_COLLECTION_INVOICE','COLD_STORAGE_INVOICES',csi.business_id,csi.total,csi.total,COALESCE((SELECT sum(cr.original_amount-cr.paid_amount) FROM customer_receivables cr WHERE cr.customer_id=sc.customer_id AND cr.source_id<>csi.business_id AND cr.status IN('unpaid','partial')),0),csi.total+COALESCE((SELECT sum(cr.original_amount-cr.paid_amount) FROM customer_receivables cr WHERE cr.customer_id=sc.customer_id AND cr.source_id<>csi.business_id AND cr.status IN('unpaid','partial')),0),csi.status,csi.created_at FROM cold_storage_invoices csi JOIN storage_contracts sc ON sc.id=csi.contract_id ON CONFLICT DO NOTHING;
INSERT INTO unified_invoices(business_id,company_id,customer_id,invoice_type,source_type,source_id,current_total,financial_impact,previous_due_snapshot,total_payable_snapshot,status,issued_at)
SELECT 'FIN-'||gr.business_id,gr.company_id,gr.customer_id,'GOODS_RECEIVING_INVOICE','GOODS_RECEIPTS',gr.business_id,gr.labor_amount+gr.service_amount,gr.labor_amount+gr.service_amount,COALESCE((SELECT sum(cr.original_amount-cr.paid_amount) FROM customer_receivables cr WHERE cr.customer_id=gr.customer_id AND cr.status IN('unpaid','partial')),0),(gr.labor_amount+gr.service_amount)+COALESCE((SELECT sum(cr.original_amount-cr.paid_amount) FROM customer_receivables cr WHERE cr.customer_id=gr.customer_id AND cr.status IN('unpaid','partial')),0),'received',gr.created_at FROM goods_receipts gr ON CONFLICT DO NOTHING;
INSERT INTO unified_invoices(business_id,company_id,customer_id,invoice_type,source_type,source_id,current_total,financial_impact,previous_due_snapshot,total_payable_snapshot,status,issued_at)
SELECT 'FIN-'||d.business_id,d.company_id,d.customer_id,'DELIVERY_INVOICE','DELIVERIES',d.business_id,COALESCE(si.total,0),0,COALESCE((SELECT sum(cr.original_amount-cr.paid_amount) FROM customer_receivables cr WHERE cr.customer_id=d.customer_id AND cr.status IN('unpaid','partial')),0),COALESCE((SELECT sum(cr.original_amount-cr.paid_amount) FROM customer_receivables cr WHERE cr.customer_id=d.customer_id AND cr.status IN('unpaid','partial')),0),d.status,d.created_at FROM deliveries d LEFT JOIN sales_invoices si ON si.id=d.invoice_id ON CONFLICT DO NOTHING;
INSERT INTO unified_invoices(business_id,company_id,customer_id,invoice_type,source_type,source_id,current_total,financial_impact,previous_due_snapshot,total_payable_snapshot,status,issued_at)
SELECT 'FIN-'||sc.business_id,sc.company_id,sc.customer_id,'RENTAL_CONTRACT','STORAGE_CONTRACTS',sc.business_id,sc.unit_quantity*rp.rate_per_unit_per_cycle*rp.min_billing_cycles,0,COALESCE((SELECT sum(cr.original_amount-cr.paid_amount) FROM customer_receivables cr WHERE cr.customer_id=sc.customer_id AND cr.status IN('unpaid','partial')),0),COALESCE((SELECT sum(cr.original_amount-cr.paid_amount) FROM customer_receivables cr WHERE cr.customer_id=sc.customer_id AND cr.status IN('unpaid','partial')),0),sc.status,sc.created_at FROM storage_contracts sc JOIN rental_policies rp ON rp.id=sc.rental_policy_id ON CONFLICT DO NOTHING;
