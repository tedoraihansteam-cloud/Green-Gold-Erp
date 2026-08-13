DELETE FROM bulk_import_jobs j
USING bulk_import_jobs newer
WHERE j.company_id=newer.company_id AND j.id<>newer.id
  AND j.source_summary->>'sourceHash'=newer.source_summary->>'sourceHash'
  AND j.status IN('review','rejected') AND newer.created_at>j.created_at
  AND NOT EXISTS(SELECT 1 FROM bulk_import_reference_rows r WHERE r.job_id=j.id);

INSERT INTO bulk_import_reference_entities(company_id,business_id,entity_type,display_name,linked_business_id)
SELECT company_id,business_id,'ACCOUNT',name,business_id FROM accounts WHERE deleted_at IS NULL
ON CONFLICT(company_id,entity_type,display_name) DO UPDATE SET linked_business_id=EXCLUDED.linked_business_id;
INSERT INTO bulk_import_reference_entities(company_id,business_id,entity_type,display_name,linked_business_id)
SELECT company_id,business_id,'CUSTOMER',name,business_id FROM master_customers WHERE deleted_at IS NULL
ON CONFLICT(company_id,entity_type,display_name) DO UPDATE SET linked_business_id=EXCLUDED.linked_business_id;
INSERT INTO bulk_import_reference_entities(company_id,business_id,entity_type,display_name,linked_business_id)
SELECT company_id,business_id,'VENDOR',name,business_id FROM master_vendors WHERE deleted_at IS NULL
ON CONFLICT(company_id,entity_type,display_name) DO UPDATE SET linked_business_id=EXCLUDED.linked_business_id;
INSERT INTO bulk_import_reference_links(reference_row_id,reference_entity_id,relationship)
SELECT r.id,e.id,'detected_profile' FROM bulk_import_reference_rows r JOIN bulk_import_reference_entities e ON e.company_id=r.company_id
WHERE r.record_data::text ILIKE '%'||e.display_name||'%' OR r.record_data::text ILIKE '%'||e.linked_business_id||'%'
ON CONFLICT DO NOTHING;
