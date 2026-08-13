-- User-requested reset of the universal upload workspace.
-- Operational ERP records are intentionally untouched. Cascades remove only
-- import approvals, postings, extracted reference rows, and reference links.
DELETE FROM bulk_import_jobs;
DELETE FROM bulk_import_reference_entities;
DELETE FROM bulk_import_entity_aliases;
