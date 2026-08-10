CREATE TABLE IF NOT EXISTS chart_of_accounts(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id UUID NOT NULL REFERENCES companies(id),
 code TEXT NOT NULL,name TEXT NOT NULL,account_class TEXT NOT NULL CHECK(account_class IN('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
 account_subtype TEXT,normal_balance TEXT NOT NULL CHECK(normal_balance IN('DEBIT','CREDIT')),parent_id UUID REFERENCES chart_of_accounts(id),
 system_key TEXT,active BOOLEAN NOT NULL DEFAULT true,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(company_id,code),UNIQUE(company_id,system_key)
);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS gl_account_id UUID REFERENCES chart_of_accounts(id);
CREATE TABLE IF NOT EXISTS journal_entries(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),business_id TEXT NOT NULL UNIQUE,company_id UUID NOT NULL REFERENCES companies(id),
 journal_date DATE NOT NULL DEFAULT CURRENT_DATE,description TEXT NOT NULL,source_type TEXT,source_id TEXT,status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN('draft','posted','reversed')),
 created_by UUID REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),posted_at TIMESTAMPTZ,UNIQUE(company_id,source_type,source_id)
);
CREATE TABLE IF NOT EXISTS journal_lines(
 id BIGSERIAL PRIMARY KEY,journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,gl_account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
 debit NUMERIC(16,2) NOT NULL DEFAULT 0,credit NUMERIC(16,2) NOT NULL DEFAULT 0,memo TEXT,cost_center_id UUID REFERENCES cost_centers(id),
 CHECK(debit>=0 AND credit>=0 AND ((debit>0 AND credit=0) OR (credit>0 AND debit=0)))
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(gl_account_id,journal_entry_id);
INSERT INTO numbering_sequences(module_code,prefix_template,padding_length,reset_policy) VALUES('GL_JOURNAL','JRN-{YYYYMMDD}-',7,'daily') ON CONFLICT(module_code) DO NOTHING;

WITH definitions(code,name,class,subtype,normal,system_key) AS (VALUES
 ('1100','Customer Receivables','ASSET','RECEIVABLE','DEBIT','CUSTOMER_RECEIVABLE'),('1200','Inventory','ASSET','INVENTORY','DEBIT','INVENTORY'),('1300','Employee Advances','ASSET','ADVANCE','DEBIT','EMPLOYEE_ADVANCE'),
 ('2100','Supplier Payables','LIABILITY','PAYABLE','CREDIT','SUPPLIER_PAYABLE'),('2200','Payroll Payable','LIABILITY','PAYABLE','CREDIT','PAYROLL_PAYABLE'),('2300','Tax and VAT Payable','LIABILITY','TAX','CREDIT','TAX_PAYABLE'),
 ('3000','Opening Balance Equity','EQUITY','OPENING','CREDIT','OPENING_EQUITY'),('3100','Retained Earnings','EQUITY','RETAINED_EARNINGS','CREDIT','RETAINED_EARNINGS'),
 ('4100','Sales Income','REVENUE','SALES','CREDIT','SALES_INCOME'),('4200','Rental Income','REVENUE','RENT','CREDIT','RENTAL_INCOME'),('4300','Service and Labor Income','REVENUE','SERVICE','CREDIT','SERVICE_INCOME'),('4900','Other Income','REVENUE','OTHER','CREDIT','OTHER_INCOME'),
 ('5100','Operating Expense','EXPENSE','OPERATING','DEBIT','OPERATING_EXPENSE'),('5200','Payroll Expense','EXPENSE','PAYROLL','DEBIT','PAYROLL_EXPENSE'),('5300','Maintenance Expense','EXPENSE','MAINTENANCE','DEBIT','MAINTENANCE_EXPENSE'),('5400','Travel and Allowance','EXPENSE','TRAVEL','DEBIT','TRAVEL_ALLOWANCE'),('5500','Tax Expense','EXPENSE','TAX','DEBIT','TAX_EXPENSE'),('5600','Capital Expenditure Clearing','ASSET','CAPITAL','DEBIT','CAPITAL_EXPENDITURE'),('1999','Internal Transfer Clearing','ASSET','CLEARING','DEBIT','TRANSFER_CLEARING')
)
INSERT INTO chart_of_accounts(company_id,code,name,account_class,account_subtype,normal_balance,system_key)
SELECT c.id,d.code,d.name,d.class,d.subtype,d.normal,d.system_key FROM companies c CROSS JOIN definitions d ON CONFLICT(company_id,code) DO NOTHING;

INSERT INTO chart_of_accounts(company_id,code,name,account_class,account_subtype,normal_balance,system_key)
SELECT a.company_id,'10'||lpad(a.id::text,6,'0'),a.name,'ASSET',upper(a.account_type),'DEBIT','CASH_ACCOUNT_'||a.id FROM accounts a ON CONFLICT(company_id,system_key) DO NOTHING;
UPDATE accounts a SET gl_account_id=coa.id FROM chart_of_accounts coa WHERE coa.company_id=a.company_id AND coa.system_key='CASH_ACCOUNT_'||a.id AND a.gl_account_id IS NULL;

INSERT INTO journal_entries(business_id,company_id,journal_date,description,source_type,source_id,status,posted_at)
SELECT 'GL-OPEN-'||a.business_id,a.company_id,CURRENT_DATE,'General ledger opening balance for '||a.name,'GL_OPENING',a.business_id,'posted',now() FROM accounts a WHERE a.current_balance<>0 ON CONFLICT(company_id,source_type,source_id) DO NOTHING;
INSERT INTO journal_lines(journal_entry_id,gl_account_id,debit,credit,memo)
SELECT je.id,a.gl_account_id,a.current_balance,0,'Opening cash/bank balance' FROM journal_entries je JOIN accounts a ON je.company_id=a.company_id AND je.source_type='GL_OPENING' AND je.source_id=a.business_id
WHERE NOT EXISTS(SELECT 1 FROM journal_lines jl WHERE jl.journal_entry_id=je.id);
INSERT INTO journal_lines(journal_entry_id,gl_account_id,debit,credit,memo)
SELECT je.id,coa.id,0,a.current_balance,'Opening equity' FROM journal_entries je JOIN accounts a ON je.company_id=a.company_id AND je.source_type='GL_OPENING' AND je.source_id=a.business_id JOIN chart_of_accounts coa ON coa.company_id=a.company_id AND coa.system_key='OPENING_EQUITY'
WHERE NOT EXISTS(SELECT 1 FROM journal_lines jl WHERE jl.journal_entry_id=je.id AND jl.gl_account_id=coa.id);
