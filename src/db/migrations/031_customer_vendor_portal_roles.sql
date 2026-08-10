-- Provide immediately assignable account identities without granting any
-- internal ERP module permission. Administrators can add granular permissions
-- from the Roles page when the relevant portal workflow requires them.
INSERT INTO roles(company_id, name, description, allowed_account_types)
SELECT id, 'Customer Portal User', 'Base login role for approved customer accounts', ARRAY['customer']::TEXT[]
FROM companies
ON CONFLICT(company_id, name) DO NOTHING;

INSERT INTO roles(company_id, name, description, allowed_account_types)
SELECT id, 'Vendor Portal User', 'Base login role for approved vendor accounts', ARRAY['vendor']::TEXT[]
FROM companies
ON CONFLICT(company_id, name) DO NOTHING;
