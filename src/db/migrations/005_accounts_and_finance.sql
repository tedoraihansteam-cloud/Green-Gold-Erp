-- Green Gold ERP - Phase 2: Accounts & Finance
--
-- Design notes:
--   * account_transactions is an append-only ledger, same pattern as
--     stock_ledger: every deposit/withdrawal/transfer is a row, and
--     accounts.current_balance is a materialized total kept in sync
--     inside the same transaction as the ledger insert.
--   * Transfers between accounts are two linked rows (TRANSFER_OUT on the
--     source, TRANSFER_IN on the destination) sharing a transfer_group_id,
--     so a transfer always shows on both accounts' statements.
--   * Expenses over a configurable threshold require approval before they
--     touch any account balance (rule #11: approval workflow by
--     threshold). Under the threshold, they post immediately.

CREATE TABLE accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     TEXT NOT NULL UNIQUE,   -- ACC-000001
    company_id      UUID NOT NULL REFERENCES companies(id),
    name            TEXT NOT NULL,           -- e.g. "Cash in Hand", "Cash at Bank - City Bank"
    account_type    TEXT NOT NULL,           -- cash, bank
    bank_name       TEXT,
    bank_account_number TEXT,
    current_balance NUMERIC(16,2) NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE account_transactions (
    id              BIGSERIAL PRIMARY KEY,
    account_id      UUID NOT NULL REFERENCES accounts(id),
    transaction_type TEXT NOT NULL,  -- DEPOSIT, WITHDRAWAL, TRANSFER_IN, TRANSFER_OUT
    amount          NUMERIC(16,2) NOT NULL, -- always positive; transaction_type gives direction
    reference_type  TEXT,             -- OPENING_BALANCE, EXPENSE, TRANSFER, INVOICE_PAYMENT, MANUAL
    reference_id    TEXT,
    transfer_group_id UUID,            -- links the two legs of a transfer together
    balance_after   NUMERIC(16,2) NOT NULL,
    created_by      UUID REFERENCES users(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_account_transactions_account ON account_transactions (account_id, created_at);

CREATE TABLE expense_categories (
    id              SERIAL PRIMARY KEY,
    company_id      UUID NOT NULL REFERENCES companies(id),
    code            TEXT NOT NULL,
    name            TEXT NOT NULL,
    UNIQUE (company_id, code)
);

CREATE TABLE expenses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     TEXT NOT NULL UNIQUE,   -- EXP-20260801-000001
    company_id      UUID NOT NULL REFERENCES companies(id),
    category_id     INTEGER NOT NULL REFERENCES expense_categories(id),
    account_id      UUID NOT NULL REFERENCES accounts(id),
    amount          NUMERIC(16,2) NOT NULL,
    description     TEXT,
    paid_to         TEXT,             -- vendor name or free text (advocate, consultant, etc. per rule #11)
    expense_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    status          TEXT NOT NULL DEFAULT 'pending_approval', -- pending_approval, approved, rejected
    created_by      UUID NOT NULL REFERENCES users(id),
    approved_by     UUID REFERENCES users(id),
    approved_at     TIMESTAMPTZ,
    rejected_reason TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_expenses_company_date ON expenses (company_id, expense_date);
