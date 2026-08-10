const { Pool } = require('pg');

// Uses standard PG* environment variables (PGHOST, PGPORT, PGDATABASE,
// PGUSER, PGPASSWORD) which node-postgres reads automatically, so no
// connection string needs to be assembled by hand.
const pool = new Pool({
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
    // Idle client errors should never crash the whole process.
    console.error('Unexpected error on idle PostgreSQL client', err);
});

/**
 * Run a query with automatic connection handling.
 */
function query(text, params) {
    return pool.query(text, params);
}

/**
 * Run a function inside a transaction. The callback receives a client
 * that must be used for every query inside the transaction.
 */
async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { pool, query, withTransaction };
