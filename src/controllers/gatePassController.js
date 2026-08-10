const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { generateForEntity } = require('../services/qrBarcodeService');
const { logAction } = require('../services/auditLogger');

const VALID_PASS_TYPES = ['OUTWARD_GOODS', 'INWARD_GOODS', 'VISITOR', 'CONTRACTOR', 'MACHINE_MOVEMENT', 'EMPLOYEE_ASSET'];

/**
 * Auto-generates an outward gate pass from an already-issued sales
 * invoice, per architecture rule #15 ("gate passes generated automatically
 * from approved business transactions where possible"). Security never
 * types in what's leaving - it's built from the invoice line items.
 */
async function createFromInvoice(req, res) {
    const { invoiceBusinessId } = req.params;
    const { vehicleNumber, contactName, contactPhone } = req.body;

    const gatePass = await withTransaction(async (client) => {
        const { rows: invoiceRows } = await client.query(
            `SELECT * FROM sales_invoices WHERE business_id = $1 AND company_id = $2`,
            [invoiceBusinessId, req.user.company_id]
        );
        if (invoiceRows.length === 0) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 });
        const invoice = invoiceRows[0];
        if (invoice.status !== 'issued') {
            throw Object.assign(new Error(`Cannot issue a gate pass for a ${invoice.status} invoice`), { statusCode: 409 });
        }

        const { rows: itemRows } = await client.query(
            `SELECT sii.quantity, p.name, p.unit FROM sales_invoice_items sii JOIN products p ON p.id = sii.product_id WHERE sii.invoice_id = $1`,
            [invoice.id]
        );
        const description = itemRows.map((i) => `${i.quantity} ${i.unit} ${i.name}`).join(', ');

        const businessId = await generateNextId('GATE_PASS');
        const { rows } = await client.query(
            `INSERT INTO gate_passes (business_id, company_id, pass_type, source_reference_type, source_reference_id, description, vehicle_number, contact_name, contact_phone, issued_by)
             VALUES ($1, $2, 'OUTWARD_GOODS', 'SALES_INVOICE', $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [businessId, req.user.company_id, invoiceBusinessId, description, vehicleNumber || null, contactName || null, contactPhone || null, req.user.id]
        );
        return rows[0];
    });

    await generateForEntity('GATE_PASS', gatePass.business_id);
    await logAction({ actorUserId: req.user.id, action: 'GATE_PASS_ISSUED', entityType: 'GATE_PASS', entityId: gatePass.business_id, after: gatePass });

    res.status(201).json({ gatePass });
}

/**
 * Manual creation for pass types with no source business transaction:
 * visitors, contractors, machine movement, employee asset movement.
 */
async function createManual(req, res) {
    const { passType, description, vehicleNumber, contactName, contactPhone } = req.body;

    if (!passType || !VALID_PASS_TYPES.includes(passType)) {
        return res.status(400).json({ error: `passType must be one of: ${VALID_PASS_TYPES.join(', ')}` });
    }
    if (passType === 'OUTWARD_GOODS') {
        return res.status(400).json({ error: 'Outward goods passes must be generated from an invoice via /from-invoice/:id, not created manually' });
    }
    if (!description) {
        return res.status(400).json({ error: 'description is required' });
    }

    const gatePass = await withTransaction(async (client) => {
        const businessId = await generateNextId('GATE_PASS');
        const { rows } = await client.query(
            `INSERT INTO gate_passes (business_id, company_id, pass_type, source_reference_type, description, vehicle_number, contact_name, contact_phone, issued_by)
             VALUES ($1, $2, $3, 'MANUAL', $4, $5, $6, $7, $8)
             RETURNING *`,
            [businessId, req.user.company_id, passType, description, vehicleNumber || null, contactName || null, contactPhone || null, req.user.id]
        );
        return rows[0];
    });

    await generateForEntity('GATE_PASS', gatePass.business_id);
    await logAction({ actorUserId: req.user.id, action: 'GATE_PASS_ISSUED', entityType: 'GATE_PASS', entityId: gatePass.business_id, after: gatePass });

    res.status(201).json({ gatePass });
}

async function listGatePasses(req, res) {
    const { status } = req.query;
    const { rows } = await query(
        `SELECT * FROM gate_passes WHERE company_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC`,
        [req.user.company_id, status || null]
    );
    res.json({ gatePasses: rows });
}

async function getGatePass(req, res) {
    const { rows } = await query(
        `SELECT * FROM gate_passes WHERE business_id = $1 AND company_id = $2`,
        [req.params.businessId, req.user.company_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Gate pass not found' });
    res.json({ gatePass: rows[0] });
}

/**
 * The security guard's action once a scan comes back valid (see
 * /api/verify). Kept as a separate step from verification itself, so a
 * verify-only scan (e.g. a curious/test scan) never accidentally releases
 * goods - confirming exit is a deliberate second action.
 */
async function confirmExit(req, res) {
    const { exitNote, remark } = req.body || {};
    const note = String(exitNote || remark || '').trim();
    if (!note) return res.status(400).json({ error: 'Exit note is required before goods or persons can leave' });
    const { rows } = await query(
        `UPDATE gate_passes SET status = 'exited', exit_confirmed_by = $1, exit_confirmed_at = now(), exit_note=$4
         WHERE business_id = $2 AND company_id = $3 AND status = 'issued'
         RETURNING *`,
        [req.user.id, req.params.businessId, req.user.company_id, note]
    );
    if (rows.length === 0) {
        return res.status(409).json({ error: 'Gate pass not found, or not in issued status' });
    }
    await logAction({ actorUserId: req.user.id, action: 'GATE_PASS_EXIT_CONFIRMED', entityType: 'GATE_PASS', entityId: rows[0].business_id, after: { exitNote: note } });
    res.json({ message: 'Exit confirmed', gatePass: rows[0] });
}

async function cancelGatePass(req, res) {
    const { reason } = req.body;
    const { rows } = await query(
        `UPDATE gate_passes SET status = 'cancelled', cancelled_by = $1, cancelled_at = now(), cancel_reason = $2
         WHERE business_id = $3 AND company_id = $4 AND status = 'issued'
         RETURNING *`,
        [req.user.id, reason || null, req.params.businessId, req.user.company_id]
    );
    if (rows.length === 0) {
        return res.status(409).json({ error: 'Gate pass not found, or already exited/cancelled' });
    }
    await logAction({ actorUserId: req.user.id, action: 'GATE_PASS_CANCELLED', entityType: 'GATE_PASS', entityId: rows[0].business_id, after: { reason } });
    res.json({ message: 'Gate pass cancelled', gatePass: rows[0] });
}

module.exports = { createFromInvoice, createManual, listGatePasses, getGatePass, confirmExit, cancelGatePass };
