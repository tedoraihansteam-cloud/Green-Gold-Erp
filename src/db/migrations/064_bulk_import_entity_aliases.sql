CREATE TABLE IF NOT EXISTS bulk_import_entity_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  normalized_alias TEXT NOT NULL,
  display_alias TEXT NOT NULL,
  target_entity_type TEXT NOT NULL CHECK(target_entity_type IN('CUSTOMER','VENDOR','EMPLOYEE','ACCOUNT')),
  target_business_id TEXT NOT NULL,
  candidate_class TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id,normalized_alias)
);
CREATE INDEX IF NOT EXISTS idx_bulk_import_alias_target ON bulk_import_entity_aliases(company_id,target_entity_type,target_business_id);
