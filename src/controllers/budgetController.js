const { query } = require('../config/db');
const { generateForEntitySafe } = require('../services/qrBarcodeService');
const { generateNextId } = require('../services/numberingEngine');
const { logAction } = require('../services/auditLogger');

async function createBudget(req, res) {
    const { name, categoryId, periodType, periodYear, periodMonth, amount, warningThresholdPercent } = req.body;
    if (!name || !categoryId || !periodType || !periodYear || !amount) {
        return res.status(400).json({ error: 'name, categoryId, periodType, periodYear, and amount are required' });
    }
    if (!['monthly', 'yearly'].includes(periodType)) {
        return res.status(400).json({ error: "periodType must be 'monthly' or 'yearly'" });
    }
    if (periodType === 'monthly' && !periodMonth) {
        return res.status(400).json({ error: 'periodMonth is required for monthly budgets' });
    }

    try {
        const businessId = await generateNextId('BUDGET');
        const { rows } = await query(
            `INSERT INTO budgets (business_id, company_id, name, category_id, period_type, period_year, period_month, amount, warning_threshold_percent, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [businessId, req.user.company_id, name, categoryId, periodType, periodYear, periodType === 'monthly' ? periodMonth : null, amount, warningThresholdPercent || 80, req.user.id]
        );
        await logAction({ actorUserId: req.user.id, action: 'BUDGET_CREATED', entityType: 'BUDGET', entityId: rows[0].business_id, after: rows[0] });
        await generateForEntitySafe('BUDGET', rows[0].business_id);
        res.status(201).json({ budget: rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'A budget already exists for this category and period' });
        throw err;
    }
}

/**
 * Actual spend is computed here, not stored - it can never drift out of
 * sync with the real expenses table. Only approved expenses count, since
 * a pending_approval expense hasn't actually happened from a budget's
 * point of view yet.
 */
async function listBudgets(req, res) {
    const { rows } = await query(
        `SELECT b.*, ec.name AS category_name,
                COALESCE(actual.total, 0) AS actual_spend
         FROM budgets b
         JOIN expense_categories ec ON ec.id = b.category_id
         LEFT JOIN LATERAL (
             SELECT sum(e.amount) AS total
             FROM expenses e
             WHERE e.category_id = b.category_id
               AND e.status = 'approved'
               AND EXTRACT(YEAR FROM e.expense_date) = b.period_year
               AND (b.period_month IS NULL OR EXTRACT(MONTH FROM e.expense_date) = b.period_month)
         ) actual ON true
         WHERE b.company_id = $1
         ORDER BY b.period_year DESC, b.period_month DESC NULLS LAST, b.name`,
        [req.user.company_id]
    );

    const budgets = rows.map((b) => {
        const amount = Number(b.amount);
        const actual = Number(b.actual_spend);
        const percentUsed = amount > 0 ? (actual / amount) * 100 : 0;
        let status = 'ok';
        if (actual > amount) status = 'exceeded';
        else if (percentUsed >= Number(b.warning_threshold_percent)) status = 'warning';
        return { ...b, actual_spend: actual, variance: amount - actual, percent_used: Math.round(percentUsed * 10) / 10, status };
    });

    res.json({ budgets });
}

module.exports = { createBudget, listBudgets };
