-- Green Gold ERP - Phase 2: Budgeting
--
-- Design notes:
--   * Budgets don't duplicate expense data - actual spend is computed at
--     read time by summing the expenses table for the same category and
--     period (rule: "three connected engines: Budget, Expense, Variance" -
--     the variance engine is just a query, not a stored table, so it can
--     never drift out of sync with real expenses).
--   * Only approved expenses count as "actual" - a pending_approval
--     expense hasn't really happened yet from a budget's perspective.

CREATE TABLE budgets (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id             TEXT NOT NULL UNIQUE,   -- BUD-2026-000001
    company_id              UUID NOT NULL REFERENCES companies(id),
    name                    TEXT NOT NULL,
    category_id             INTEGER NOT NULL REFERENCES expense_categories(id),
    period_type             TEXT NOT NULL,   -- monthly, yearly
    period_year             INTEGER NOT NULL,
    period_month            INTEGER,          -- 1-12, null for yearly budgets
    amount                  NUMERIC(14,2) NOT NULL,
    warning_threshold_percent NUMERIC(5,2) NOT NULL DEFAULT 80,
    created_by               UUID NOT NULL REFERENCES users(id),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, category_id, period_type, period_year, period_month)
);
