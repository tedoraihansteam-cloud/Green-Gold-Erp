const { withTransaction } = require('../config/db');

/**
 * Numbering engine.
 *
 * Every module that needs a permanent human-readable business ID
 * (customer, employee, invoice, gate pass, etc.) goes through this
 * function instead of generating its own numbers. That keeps the
 * numbering rule configurable (via the numbering_sequences table)
 * rather than hard-coded per module, per architecture rule #8.
 *
 * IDs are never reused: even if a reset_policy rolls the counter back
 * to 0 for a new period, the resulting business_id is unique because
 * the period is embedded in the prefix.
 */

function resolvePeriodKey(resetPolicy, now) {
    const yyyy = now.getFullYear().toString();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    switch (resetPolicy) {
        case 'yearly':
            return yyyy;
        case 'monthly':
            return `${yyyy}${mm}`;
        case 'daily':
            return `${yyyy}${mm}${dd}`;
        case 'never':
        default:
            return 'ALWAYS';
    }
}

function resolvePrefix(template, now) {
    const yyyy = now.getFullYear().toString();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return template
        .replace('{YYYYMMDD}', `${yyyy}${mm}${dd}`)
        .replace('{YYYY}', yyyy)
        .replace('{MM}', mm)
        .replace('{DD}', dd);
}

/**
 * Generate the next business ID for a module.
 *
 * @param {string} moduleCode - e.g. 'CUSTOMER', 'INVOICE', 'GATE_PASS'
 * @returns {Promise<string>} the generated business ID, e.g. 'INV-20260801-000001'
 */
async function generateNextId(moduleCode) {
    return withTransaction(async (client) => {
        // Row lock prevents two concurrent requests from getting the same number.
        const { rows } = await client.query(
            `SELECT * FROM numbering_sequences WHERE module_code = $1 FOR UPDATE`,
            [moduleCode]
        );

        if (rows.length === 0) {
            throw new Error(`No numbering sequence configured for module '${moduleCode}'`);
        }

        const seq = rows[0];
        const now = new Date();
        const periodKey = resolvePeriodKey(seq.reset_policy, now);

        let nextNumber;
        if (seq.reset_policy !== 'never' && seq.last_reset_period !== periodKey) {
            // New period started (e.g. new day/month/year) - counter resets,
            // but the prefix changes too, so the full business_id stays unique.
            nextNumber = 1;
        } else {
            nextNumber = Number(seq.current_number) + 1;
        }

        await client.query(
            `UPDATE numbering_sequences
             SET current_number = $1, last_reset_period = $2, updated_at = now()
             WHERE module_code = $3`,
            [nextNumber, periodKey, moduleCode]
        );

        const prefix = resolvePrefix(seq.prefix_template, now);
        const paddedNumber = String(nextNumber).padStart(seq.padding_length, '0');
        return `${prefix}${paddedNumber}`;
    });
}

module.exports = { generateNextId };
