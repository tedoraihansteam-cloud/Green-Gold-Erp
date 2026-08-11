ALTER TABLE master_employees ADD COLUMN IF NOT EXISTS profile_photo_path TEXT;
ALTER TABLE master_customers ADD COLUMN IF NOT EXISTS profile_photo_path TEXT;
ALTER TABLE master_vendors ADD COLUMN IF NOT EXISTS profile_photo_path TEXT;

ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS visitor_photo_path TEXT;
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS affiliated_entity_type TEXT;
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS affiliated_entity_business_id TEXT;
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS affiliated_organization_name TEXT;
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS host_name TEXT;
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS visit_location TEXT;
ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ;

ALTER TABLE gate_passes DROP CONSTRAINT IF EXISTS gate_pass_affiliation_type_check;
ALTER TABLE gate_passes ADD CONSTRAINT gate_pass_affiliation_type_check
  CHECK (affiliated_entity_type IS NULL OR affiliated_entity_type IN ('CUSTOMER','VENDOR','EMPLOYEE','OTHER_ORGANIZATION'));

CREATE INDEX IF NOT EXISTS idx_gate_pass_affiliation
  ON gate_passes(company_id, affiliated_entity_type, affiliated_entity_business_id);
