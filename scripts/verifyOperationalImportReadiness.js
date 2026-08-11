require('dotenv').config();
const { pool } = require('../src/config/db');

async function main() {
    const requiredTables = [
        'bulk_import_jobs', 'bulk_import_postings', 'bulk_import_approval_events',
        'master_employees', 'payroll_runs', 'payroll_items', 'employee_salary_history',
        'master_vendors', 'bill_submissions', 'accounts', 'account_transactions',
        'products', 'product_batches', 'goods_receipts', 'stock_balances',
        'master_customers', 'customer_receivables'
    ];
    const requiredSequences = ['EMPLOYEE', 'PAYROLL_RUN', 'VENDOR', 'BILL_SUBMISSION', 'PRODUCT', 'PRODUCT_BATCH', 'GOODS_RECEIPT', 'CUSTOMER'];
    const tables = (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1::text[])`, [requiredTables])).rows.map((row) => row.table_name);
    const sequences = (await pool.query(`SELECT module_code FROM numbering_sequences WHERE module_code=ANY($1::text[])`, [requiredSequences])).rows.map((row) => row.module_code);
    const migrations = (await pool.query(`SELECT filename FROM schema_migrations WHERE filename=ANY($1::text[])`, [['061_bulk_import_layered_approval.sql', '062_data_correction_module_actions.sql']])).rows.map((row) => row.filename);
    const jobs = (await pool.query(`SELECT status,count(*)::int count FROM bulk_import_jobs GROUP BY status ORDER BY status`)).rows;
    const postings = (await pool.query(`SELECT status,count(*)::int count FROM bulk_import_postings GROUP BY status ORDER BY status`)).rows;
    const missingTables = requiredTables.filter((name) => !tables.includes(name));
    const missingSequences = requiredSequences.filter((name) => !sequences.includes(name));
    const requiredMigrationsApplied = ['061_bulk_import_layered_approval.sql', '062_data_correction_module_actions.sql'].every((name) => migrations.includes(name));
    console.log(JSON.stringify({ requiredMigrationsApplied, missingTables, missingSequences, jobs, postings }));
    if (!requiredMigrationsApplied || missingTables.length || missingSequences.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
