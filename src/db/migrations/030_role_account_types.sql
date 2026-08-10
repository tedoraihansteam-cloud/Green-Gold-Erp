-- Roles can be offered only to compatible login-account types. Existing
-- roles remain staff-only until an administrator explicitly enables them
-- for customer or vendor accounts.
ALTER TABLE roles
    ADD COLUMN IF NOT EXISTS allowed_account_types TEXT[] NOT NULL DEFAULT ARRAY['staff']::TEXT[];

ALTER TABLE roles
    DROP CONSTRAINT IF EXISTS roles_allowed_account_types_check;

ALTER TABLE roles
    ADD CONSTRAINT roles_allowed_account_types_check CHECK (
        cardinality(allowed_account_types) > 0
        AND allowed_account_types <@ ARRAY['staff', 'customer', 'vendor']::TEXT[]
    );
