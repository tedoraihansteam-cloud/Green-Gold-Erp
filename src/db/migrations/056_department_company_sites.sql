ALTER TABLE departments ADD COLUMN IF NOT EXISTS company_site_id UUID REFERENCES company_sites(id);
INSERT INTO company_sites(company_id,site_type,name,address)
SELECT b.company_id,'office',b.name,b.address FROM branches b
WHERE EXISTS(SELECT 1 FROM departments d WHERE d.branch_id=b.id)
AND NOT EXISTS(SELECT 1 FROM company_sites cs WHERE cs.company_id=b.company_id AND (lower(cs.name)=lower(b.name) OR (cs.address IS NOT NULL AND b.address IS NOT NULL AND lower(cs.address)=lower(b.address))));
UPDATE departments d SET company_site_id=cs.id FROM branches b JOIN company_sites cs ON cs.company_id=b.company_id AND (lower(cs.name)=lower(b.name) OR (cs.address IS NOT NULL AND b.address IS NOT NULL AND lower(cs.address)=lower(b.address))) WHERE d.branch_id=b.id AND d.company_site_id IS NULL;
ALTER TABLE departments DROP COLUMN IF EXISTS phone,DROP COLUMN IF EXISTS email;
CREATE INDEX IF NOT EXISTS idx_departments_company_site ON departments(company_site_id);
