require('dotenv').config();
const { pool, query } = require('../config/db');
const { generateForEntity } = require('../services/qrBarcodeService');

async function run() {
    const sources = [
        ['ACCOUNT','accounts'], ['BUDGET','budgets'], ['COLD_STORAGE_INVOICE','cold_storage_invoices'],
        ['DELIVERY','deliveries'], ['VEHICLE','delivery_vehicles'], ['EXPENSE','expenses'],
        ['GATE_PASS','gate_passes'], ['MACHINE_INCIDENT','machine_incidents'], ['MACHINE','machines'],
        ['CUSTOMER','master_customers'], ['EMPLOYEE','master_employees'], ['VENDOR','master_vendors'],
        ['PAYROLL_RUN','payroll_runs'], ['PRODUCT','products'], ['RENTAL_POLICY','rental_policies'],
        ['SALARY_TEMPLATE','salary_templates'], ['INVOICE','sales_invoices'],
        ['COLD_STORAGE_CONTRACT','storage_contracts'], ['STORAGE_LOCATION','storage_locations'], ['WAREHOUSE','warehouses'],
        ['PRODUCT_BATCH','product_batches'], ['PRODUCT_UNIT','product_batch_units'], ['CUSTOMER_CHARGE','customer_charges'], ['CUSTOMER_PAYMENT','customer_payments']
    ];
    const rows = [];
    for (const [entityType, table] of sources) {
        const result = await query(`SELECT business_id FROM ${table} WHERE business_id IS NOT NULL`);
        rows.push(...result.rows.map((row) => ({ entity_type: entityType, entity_id: row.business_id })));
    }
    for (const row of rows) {
        await generateForEntity(row.entity_type, row.entity_id);
        console.log(`sync ${row.entity_type} ${row.entity_id}`);
    }
    console.log(`Synchronized ${rows.length} QR/barcode pairs`);
    await pool.end();
}

run().catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exitCode = 1;
});
