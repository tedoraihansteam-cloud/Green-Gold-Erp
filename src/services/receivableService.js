async function createReceivable(client, { companyId, customerId, sourceType, sourceId, description, amount, dueDate }) {
    const { rows } = await client.query(
        `INSERT INTO customer_receivables (company_id, customer_id, source_type, source_id, description, original_amount, due_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (source_type, source_id) DO UPDATE SET description = EXCLUDED.description
         RETURNING *`,
        [companyId, customerId, sourceType, sourceId, description || null, amount, dueDate]
    );
    return rows[0];
}

async function cancelReceivable(client, sourceType, sourceId) {
    const { rows } = await client.query(
        `UPDATE customer_receivables SET status = 'cancelled', cancelled_at = now()
         WHERE source_type = $1 AND source_id = $2 AND paid_amount = 0 AND status != 'cancelled' RETURNING *`,
        [sourceType, sourceId]
    );
    if (!rows.length) throw Object.assign(new Error('Receivable cannot be cancelled because it has payments or is already cancelled'), { statusCode: 409 });
    return rows[0];
}

module.exports = { createReceivable, cancelReceivable };

