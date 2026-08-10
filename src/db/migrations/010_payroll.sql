-- Green Gold ERP - Phase 2: Payroll
--
-- Design notes:
--   * Salary is never overwritten (rule #12: "never overwrite old salary,
--     keep salary history by effective date"). Setting a new salary closes
--     the previous employee_salary_history row (end_date) and inserts a
--     new one - both remain queryable forever.
--   * Salary increments are manual-approval-only by construction: there
--     is no automatic-increase code path, only an explicit "set salary"
--     action a human calls.
--   * A payroll run is drafted (one salary-slip row per active employee,
--     seeded from their current salary), then HR can adjust individual
--     slips (overtime, bonus, deductions) before processing. Processing
--     is the one irreversible step that posts a single aggregate
--     withdrawal to the paying account, per rule #11 (auto-post from
--     operational transactions).

CREATE TABLE salary_templates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         TEXT NOT NULL UNIQUE,   -- ST-000001
    company_id          UUID NOT NULL REFERENCES companies(id),
    name                TEXT NOT NULL,           -- e.g. "Sales Officer - Grade 1"
    basic               NUMERIC(14,2) NOT NULL DEFAULT 0,
    house_rent          NUMERIC(14,2) NOT NULL DEFAULT 0,
    medical             NUMERIC(14,2) NOT NULL DEFAULT 0,
    transport           NUMERIC(14,2) NOT NULL DEFAULT 0,
    food                NUMERIC(14,2) NOT NULL DEFAULT 0,
    special_allowance   NUMERIC(14,2) NOT NULL DEFAULT 0,
    provident_fund_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE employee_salary_history (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID NOT NULL REFERENCES companies(id),
    employee_id         UUID NOT NULL REFERENCES master_employees(id),
    template_id         UUID REFERENCES salary_templates(id),
    basic               NUMERIC(14,2) NOT NULL DEFAULT 0,
    house_rent          NUMERIC(14,2) NOT NULL DEFAULT 0,
    medical             NUMERIC(14,2) NOT NULL DEFAULT 0,
    transport           NUMERIC(14,2) NOT NULL DEFAULT 0,
    food                NUMERIC(14,2) NOT NULL DEFAULT 0,
    special_allowance   NUMERIC(14,2) NOT NULL DEFAULT 0,
    provident_fund_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    effective_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date            DATE,             -- set when a later record supersedes this one
    set_by              UUID NOT NULL REFERENCES users(id),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_salary_history_employee ON employee_salary_history (employee_id, effective_date);

CREATE TABLE payroll_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         TEXT NOT NULL UNIQUE,   -- PR-202608-000001
    company_id          UUID NOT NULL REFERENCES companies(id),
    period_year         INTEGER NOT NULL,
    period_month         INTEGER NOT NULL,       -- 1-12
    status                TEXT NOT NULL DEFAULT 'draft', -- draft, processed
    paying_account_id     UUID REFERENCES accounts(id),
    created_by             UUID NOT NULL REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_by             UUID REFERENCES users(id),
    processed_at              TIMESTAMPTZ,
    UNIQUE (company_id, period_year, period_month)
);

CREATE TABLE payroll_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_run_id      UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES master_employees(id),
    basic               NUMERIC(14,2) NOT NULL DEFAULT 0,
    house_rent          NUMERIC(14,2) NOT NULL DEFAULT 0,
    medical              NUMERIC(14,2) NOT NULL DEFAULT 0,
    transport             NUMERIC(14,2) NOT NULL DEFAULT 0,
    food                    NUMERIC(14,2) NOT NULL DEFAULT 0,
    special_allowance        NUMERIC(14,2) NOT NULL DEFAULT 0,
    overtime                  NUMERIC(14,2) NOT NULL DEFAULT 0,
    bonus                       NUMERIC(14,2) NOT NULL DEFAULT 0,
    provident_fund_deduction     NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_deduction                  NUMERIC(14,2) NOT NULL DEFAULT 0,
    late_deduction                   NUMERIC(14,2) NOT NULL DEFAULT 0,
    loan_deduction                     NUMERIC(14,2) NOT NULL DEFAULT 0,
    advance_deduction                    NUMERIC(14,2) NOT NULL DEFAULT 0,
    other_deduction                        NUMERIC(14,2) NOT NULL DEFAULT 0,
    gross_pay                                NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_deductions                          NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_pay                                     NUMERIC(14,2) NOT NULL DEFAULT 0,
    UNIQUE (payroll_run_id, employee_id)
);
