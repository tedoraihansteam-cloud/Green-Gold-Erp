-- Central request workflows. Individual assignees are stored as
-- assigneeUserId inside approval_steps and remain company-scoped.
WITH request_types(workflow_key,display_name,department,permission) AS (VALUES
 ('request_delivery_request','Delivery request','logistics','LOGISTICS_APPROVE'),
 ('request_gate_pass_request','Gate pass request','security','SECURITY_APPROVE'),
 ('request_invoice_request','Invoice preparation or review request','accounts','ACCOUNTS_APPROVE'),
 ('request_service_request','Service request','operations','USER_MANAGEMENT_APPROVE'),
 ('request_machine_maintenance_request','Machinery maintenance request','manufacturing','MANUFACTURING_APPROVE'),
 ('request_procurement_request','Procurement or purchase request','procurement','USER_MANAGEMENT_APPROVE'),
 ('request_stock_transfer_request','Stock transfer request','inventory','INVENTORY_APPROVE'),
 ('request_rental_request','Rental or storage request','cold-storage','COLD_STORAGE_APPROVE'),
 ('request_payment_request','Payment request','accounts','ACCOUNTS_APPROVE')
)
INSERT INTO workflow_definitions(company_id,workflow_key,display_name,approval_steps)
SELECT c.id,r.workflow_key,r.display_name,
 jsonb_build_array(jsonb_build_object('name',r.display_name||' review','department',r.department,'permission',r.permission,'required',true,'allowReject',true))
FROM companies c CROSS JOIN request_types r
ON CONFLICT(company_id,workflow_key) DO NOTHING;
