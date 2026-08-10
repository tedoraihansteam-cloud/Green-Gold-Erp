/**
 * Minimal migration runner.
 *
 * Deliberately not using a heavyweight ORM/migration framework for Phase 1 -
 * this just applies .sql files in src/db/migrations in filename order, and
 * keeps track of what has already run in a schema_migrations table. This
 * keeps the whole system easy for a future team to read without needing to
 * learn a specific ORM's migration DSL first.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename    TEXT PRIMARY KEY,
            applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
}

async function getAppliedMigrations() {
    const { rows } = await pool.query('SELECT filename FROM schema_migrations');
    return new Set(rows.map((r) => r.filename));
}

async function run() {
    await ensureMigrationsTable();
    const applied = await getAppliedMigrations();

    const files = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();

    for (const file of files) {
        if (applied.has(file)) {
            console.log(`skip  ${file} (already applied)`);
            continue;
        }

        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
            await client.query('COMMIT');
            console.log(`apply ${file}`);
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(`FAILED ${file}:`, err.message);
            process.exitCode = 1;
            break;
        } finally {
            client.release();
        }
    }

    await pool.end();
}

run();
