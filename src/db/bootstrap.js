/**
 * First-run bootstrap.
 *
 * Run once after migrations: `node src/db/bootstrap.js`
 * Reads settings from env vars (with sensible defaults) so it can be run
 * unattended during the one-click installer flow, not just by hand.
 *
 * Safe to re-run: it checks for existing rows before creating anything.
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');

const COMPANY_NAME = process.env.BOOTSTRAP_COMPANY_NAME || 'Green Gold Agro Products Ltd';
const ADMIN_USERNAME = process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'ChangeMe123!';
const ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL || null;

async function run() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let { rows: companyRows } = await client.query('SELECT * FROM companies WHERE name = $1', [COMPANY_NAME]);
        let company = companyRows[0];
        if (!company) {
            ({ rows: companyRows } = await client.query(
                `INSERT INTO companies (name, country) VALUES ($1, 'BD') RETURNING *`,
                [COMPANY_NAME]
            ));
            company = companyRows[0];
            console.log(`Created company: ${company.name}`);
        }

        let { rows: branchRows } = await client.query('SELECT * FROM branches WHERE company_id = $1 LIMIT 1', [company.id]);
        let branch = branchRows[0];
        if (!branch) {
            ({ rows: branchRows } = await client.query(
                `INSERT INTO branches (company_id, name) VALUES ($1, 'Head Office') RETURNING *`,
                [company.id]
            ));
            branch = branchRows[0];
            console.log(`Created branch: ${branch.name}`);
        }

        let { rows: roleRows } = await client.query(
            `SELECT * FROM roles WHERE company_id = $1 AND name = 'Super Admin'`,
            [company.id]
        );
        let role = roleRows[0];
        if (!role) {
            ({ rows: roleRows } = await client.query(
                `INSERT INTO roles (company_id, name, description, is_system_role)
                 VALUES ($1, 'Super Admin', 'Full access to every module', true) RETURNING *`,
                [company.id]
            ));
            role = roleRows[0];
            console.log(`Created role 'Super Admin'`);
        }

        // Always sync, even if the role already existed - a new module
        // added after first bootstrap (e.g. Budget) would otherwise leave
        // Super Admin silently missing its permissions.
        const { rows: allPermissions } = await client.query('SELECT id FROM permissions');
        let grantedCount = 0;
        for (const p of allPermissions) {
            const { rowCount } = await client.query(
                `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [role.id, p.id]
            );
            grantedCount += rowCount;
        }
        console.log(`Super Admin now has all ${allPermissions.length} permissions (${grantedCount} newly granted)`);

        const { rows: existingAdmin } = await client.query('SELECT * FROM users WHERE username = $1', [ADMIN_USERNAME]);
        if (existingAdmin.length === 0) {
            const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
            const { rows: newAdminRows } = await client.query(
                `INSERT INTO users (company_id, username, email, password_hash, account_type, status, branch_id, approved_at)
                 VALUES ($1, $2, $3, $4, 'staff', 'active', $5, now())
                 RETURNING *`,
                [company.id, ADMIN_USERNAME, ADMIN_EMAIL, passwordHash, branch.id]
            );
            const admin = newAdminRows[0];
            await client.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [admin.id, role.id]);

            console.log('\nFirst admin account created:');
            console.log(`  username: ${ADMIN_USERNAME}`);
            console.log(`  password: ${ADMIN_PASSWORD}`);
            console.log('  -> Log in and change this password immediately.\n');
        } else {
            console.log(`Admin user '${ADMIN_USERNAME}' already exists - skipping.`);
        }

        const { rows: existingAccounts } = await client.query('SELECT count(*) FROM accounts WHERE company_id = $1', [company.id]);
        if (Number(existingAccounts[0].count) === 0) {
            for (const [name, type] of [['Cash in Hand', 'cash'], ['Cash at Bank', 'bank']]) {
                const businessId = await generateNextId('ACCOUNT');
                await client.query(
                    `INSERT INTO accounts (business_id, company_id, name, account_type) VALUES ($1, $2, $3, $4)`,
                    [businessId, company.id, name, type]
                );
            }
            console.log("Created default accounts: 'Cash in Hand' and 'Cash at Bank'");
        }

        const { rows: existingCategories } = await client.query('SELECT count(*) FROM expense_categories WHERE company_id = $1', [company.id]);
        if (Number(existingCategories[0].count) === 0) {
            const defaultCategories = [
                ['GENERAL', 'General Expense'],
                ['UTILITY', 'Utility Bills'],
                ['TRANSPORT', 'Transport & Fuel'],
                ['SALARY', 'Salary & Wages'],
                ['PROFESSIONAL_FEE', 'Professional / Advisory Fees'],
                ['MAINTENANCE', 'Repair & Maintenance']
            ];
            for (const [code, name] of defaultCategories) {
                await client.query(
                    `INSERT INTO expense_categories (company_id, code, name) VALUES ($1, $2, $3)`,
                    [company.id, code, name]
                );
            }
            console.log(`Created ${defaultCategories.length} default expense categories`);
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Bootstrap failed:', err);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

run();
