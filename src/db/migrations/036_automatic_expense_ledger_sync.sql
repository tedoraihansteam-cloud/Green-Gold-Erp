-- Every external account withdrawal is represented in Expenses. Transfers are
-- excluded because they only move company money between company accounts.
ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS source_transaction_id BIGINT UNIQUE REFERENCES account_transactions(id),
    ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS source_reference_type TEXT,
    ADD COLUMN IF NOT EXISTS source_reference_id TEXT;

INSERT INTO expense_categories(company_id,code,name)
SELECT id,'AUTO_OUTFLOW','Automatic account deductions' FROM companies
ON CONFLICT(company_id,code) DO NOTHING;

INSERT INTO expenses(
    business_id,company_id,category_id,account_id,amount,description,paid_to,
    expense_date,status,created_by,approved_by,approved_at,source_transaction_id,
    auto_generated,source_reference_type,source_reference_id,created_at
)
SELECT
    'EXP-AUTO-' || at.id,
    a.company_id,
    ec.id,
    at.account_id,
    at.amount,
    COALESCE(at.notes,replace(initcap(at.reference_type),'_',' '),'Automatic account deduction'),
    NULL,
    at.created_at::date,
    'approved',
    at.created_by,
    at.created_by,
    at.created_at,
    at.id,
    true,
    at.reference_type,
    at.reference_id,
    at.created_at
FROM account_transactions at
JOIN accounts a ON a.id=at.account_id
JOIN expense_categories ec ON ec.company_id=a.company_id AND ec.code='AUTO_OUTFLOW'
WHERE at.transaction_type='WITHDRAWAL'
  AND COALESCE(at.reference_type,'') <> 'EXPENSE'
  AND NOT EXISTS(SELECT 1 FROM expenses e WHERE e.source_transaction_id=at.id)
ON CONFLICT(business_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_expenses_source_reference
    ON expenses(company_id,source_reference_type,source_reference_id);
