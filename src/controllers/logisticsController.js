const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { generateForEntity } = require('../services/qrBarcodeService');
const { logAction } = require('../services/auditLogger');

// ---------------- Vehicles ----------------

async function createVehicle(req, res) {
    const { vehicleNumber, vehicleType, capacityUnit, capacityValue, driverName, driverPhone } = req.body;
    if (!vehicleNumber) return res.status(400).json({ error: 'vehicleNumber is required' });

    try {
        const vehicle = await withTransaction(async (client) => {
            const businessId = await generateNextId('VEHICLE');
            const { rows } = await client.query(
                `INSERT INTO delivery_vehicles (business_id, company_id, vehicle_number, vehicle_type, capacity_unit, capacity_value, driver_name, driver_phone)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
                [businessId, req.user.company_id, vehicleNumber, vehicleType || null, capacityUnit || null, capacityValue || null, driverName || null, driverPhone || null]
            );
            return rows[0];
        });
        await generateForEntity('VEHICLE', vehicle.business_id);
        await logAction({ actorUserId: req.user.id, action: 'VEHICLE_CREATED', entityType: 'VEHICLE', entityId: vehicle.business_id, after: vehicle });
        res.status(201).json({ vehicle });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'A vehicle with this number already exists' });
        throw err;
    }
}

async function listVehicles(req, res) {
    const { rows } = await query(`SELECT * FROM delivery_vehicles WHERE company_id = $1 AND deleted_at IS NULL ORDER BY vehicle_number`, [req.user.company_id]);
    res.json({ vehicles: rows });
}

// ---------------- Deliveries ----------------

/**
 * Reuses whatever's already on file for the invoice (customer, items via
 * the invoice reference) and optionally the gate pass that authorized the
 * goods to leave, rather than re-entering delivery details from scratch.
 */
async function createDelivery(req, res) {
    const { invoiceBusinessId, customerBusinessId, deliveryAddress, scheduledDate, vehicleNumber, contactName, contactPhone } = req.body;
    if (!invoiceBusinessId && !customerBusinessId) {
        return res.status(400).json({ error: 'Provide either invoiceBusinessId or customerBusinessId' });
    }

    const delivery = await withTransaction(async (client) => {
        let customerId = null;
        let invoiceId = null;
        let gatePassId = null;

        if (invoiceBusinessId) {
            const { rows } = await client.query(`SELECT id, customer_id, status FROM sales_invoices WHERE business_id = $1 AND company_id = $2`, [invoiceBusinessId, req.user.company_id]);
            if (rows.length === 0) throw Object.assign(new Error('Invoice not found'), { statusCode: 404 });
            if (rows[0].status !== 'issued') throw Object.assign(new Error('Delivery requires an issued invoice'), { statusCode: 409 });
            invoiceId = rows[0].id;
            customerId = rows[0].customer_id;
        }
        if (customerBusinessId) {
            const { rows } = await client.query(`SELECT id FROM master_customers WHERE business_id = $1 AND company_id = $2`, [customerBusinessId, req.user.company_id]);
            if (rows.length === 0) throw Object.assign(new Error('Customer not found'), { statusCode: 404 });
            customerId = rows[0].id;
        }
        // Delivery invoices must carry an outward gate pass.  Stock was already
        // released atomically when the issued sales invoice was created; doing
        // another OUT movement here would deduct the same goods twice.
        if (invoiceBusinessId) {
            const { rows: itemRows } = await client.query(
                `SELECT sii.quantity,p.name,p.unit FROM sales_invoice_items sii JOIN products p ON p.id=sii.product_id WHERE sii.invoice_id=$1`,
                [invoiceId]
            );
            if (!itemRows.length) throw Object.assign(new Error('The invoice has no stock items to deliver'), { statusCode: 409 });
            const { rows: existingPasses } = await client.query(
                `SELECT * FROM gate_passes WHERE company_id=$1 AND source_reference_type='SALES_INVOICE' AND source_reference_id=$2 AND status='issued' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
                [req.user.company_id, invoiceBusinessId]
            );
            if (existingPasses.length) gatePassId = existingPasses[0].id;
            else {
                const gatePassBusinessId = await generateNextId('GATE_PASS');
                const description = itemRows.map(i => `${i.quantity} ${i.unit} ${i.name}`).join(', ');
                const { rows: passes } = await client.query(
                    `INSERT INTO gate_passes(business_id,company_id,pass_type,source_reference_type,source_reference_id,description,vehicle_number,contact_name,contact_phone,issued_by)
                     VALUES($1,$2,'OUTWARD_GOODS','SALES_INVOICE',$3,$4,$5,$6,$7,$8) RETURNING *`,
                    [gatePassBusinessId,req.user.company_id,invoiceBusinessId,description,vehicleNumber||null,contactName||null,contactPhone||null,req.user.id]
                );
                gatePassId = passes[0].id;
            }
        }

        const businessId = await generateNextId('DELIVERY');
        const { rows } = await client.query(
            `INSERT INTO deliveries (business_id, company_id, customer_id, invoice_id, gate_pass_id, delivery_address, scheduled_date, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [businessId, req.user.company_id, customerId, invoiceId, gatePassId, deliveryAddress || null, scheduledDate || null, req.user.id]
        );
        return rows[0];
    });

    await generateForEntity('DELIVERY', delivery.business_id);
    const { rows: passRows } = await query(`SELECT business_id FROM gate_passes WHERE id=$1`, [delivery.gate_pass_id]);
    if (passRows[0]) await generateForEntity('GATE_PASS', passRows[0].business_id);
    await logAction({ actorUserId: req.user.id, action: 'DELIVERY_CREATED', entityType: 'DELIVERY', entityId: delivery.business_id, after: delivery });
    res.status(201).json({ delivery, gatePassBusinessId: passRows[0]?.business_id, stockDeducted: Boolean(invoiceBusinessId) });
}

async function listDeliveries(req, res) {
    const { status } = req.query;
    const { rows } = await query(
        `SELECT d.*, c.business_id AS customer_business_id, c.name AS customer_name,
                v.business_id AS vehicle_business_id, v.vehicle_number,
                si.business_id AS invoice_business_id, gp.business_id AS gate_pass_business_id
         FROM deliveries d
         JOIN master_customers c ON c.id = d.customer_id
         LEFT JOIN delivery_vehicles v ON v.id = d.vehicle_id
         LEFT JOIN sales_invoices si ON si.id = d.invoice_id
         LEFT JOIN gate_passes gp ON gp.id = d.gate_pass_id
         WHERE d.company_id = $1 AND ($2::text IS NULL OR d.status = $2)
         ORDER BY d.created_at DESC`,
        [req.user.company_id, status || null]
    );
    res.json({ deliveries: rows });
}

async function dispatchDelivery(req, res) {
    const { vehicleBusinessId } = req.body;
    if (!vehicleBusinessId) return res.status(400).json({ error: 'vehicleBusinessId is required' });

    const delivery = await withTransaction(async (client) => {
        const { rows: vRows } = await client.query(
            `SELECT * FROM delivery_vehicles WHERE business_id = $1 AND company_id = $2 AND deleted_at IS NULL FOR UPDATE`,
            [vehicleBusinessId, req.user.company_id]
        );
        if (vRows.length === 0) throw Object.assign(new Error('Vehicle not found'), { statusCode: 404 });
        if (vRows[0].status !== 'available') throw Object.assign(new Error(`Vehicle is currently ${vRows[0].status}, not available`), { statusCode: 409 });

        const { rows: dRows } = await client.query(
            `SELECT * FROM deliveries WHERE business_id = $1 AND company_id = $2 FOR UPDATE`,
            [req.params.businessId, req.user.company_id]
        );
        if (dRows.length === 0) throw Object.assign(new Error('Delivery not found'), { statusCode: 404 });
        if (dRows[0].status !== 'scheduled') throw Object.assign(new Error(`Delivery is ${dRows[0].status}, not scheduled`), { statusCode: 409 });
        if (!dRows[0].gate_pass_id) throw Object.assign(new Error('A gate pass is mandatory before dispatch'), { statusCode: 409 });
        const { rows: passRows } = await client.query(`SELECT status FROM gate_passes WHERE id=$1 FOR UPDATE`,[dRows[0].gate_pass_id]);
        if (!passRows.length || passRows[0].status!=='issued') throw Object.assign(new Error('Delivery requires a valid issued gate pass'), { statusCode: 409 });

        await client.query(`UPDATE delivery_vehicles SET status = 'on_delivery' WHERE id = $1`, [vRows[0].id]);
        const { rows: updated } = await client.query(
            `UPDATE deliveries SET status = 'in_transit', vehicle_id = $1, dispatched_by = $2, dispatched_at = now() WHERE id = $3 RETURNING *`,
            [vRows[0].id, req.user.id, dRows[0].id]
        );
        return updated[0];
    });

    await logAction({ actorUserId: req.user.id, action: 'DELIVERY_DISPATCHED', entityType: 'DELIVERY', entityId: delivery.business_id, after: { vehicleBusinessId } });
    res.json({ message: 'Delivery dispatched', delivery });
}

async function completeDelivery(req, res) {
    const { proofNotes } = req.body;
    const delivery = await withTransaction(async (client) => {
        const { rows: dRows } = await client.query(`SELECT * FROM deliveries WHERE business_id = $1 AND company_id = $2 FOR UPDATE`, [req.params.businessId, req.user.company_id]);
        if (dRows.length === 0) throw Object.assign(new Error('Delivery not found'), { statusCode: 404 });
        if (dRows[0].status !== 'in_transit') throw Object.assign(new Error(`Delivery is ${dRows[0].status}, not in transit`), { statusCode: 409 });
        if (!dRows[0].gate_pass_id) throw Object.assign(new Error('A gate pass is mandatory before delivery'), { statusCode: 409 });
        const { rows: passRows } = await client.query(`SELECT status FROM gate_passes WHERE id=$1`,[dRows[0].gate_pass_id]);
        if (!passRows.length || passRows[0].status!=='exited') throw Object.assign(new Error('Security must confirm the gate pass exit before completing delivery'), { statusCode: 409 });

        if (dRows[0].vehicle_id) await client.query(`UPDATE delivery_vehicles SET status = 'available' WHERE id = $1`, [dRows[0].vehicle_id]);
        const { rows: updated } = await client.query(
            `UPDATE deliveries SET status = 'delivered', delivered_at = now(), proof_notes = $1 WHERE id = $2 RETURNING *`,
            [proofNotes || null, dRows[0].id]
        );
        return updated[0];
    });

    await logAction({ actorUserId: req.user.id, action: 'DELIVERY_COMPLETED', entityType: 'DELIVERY', entityId: delivery.business_id });
    res.json({ message: 'Delivery marked complete', delivery });
}

async function failDelivery(req, res) {
    const { reason } = req.body;
    const delivery = await withTransaction(async (client) => {
        const { rows: dRows } = await client.query(`SELECT * FROM deliveries WHERE business_id = $1 AND company_id = $2 FOR UPDATE`, [req.params.businessId, req.user.company_id]);
        if (dRows.length === 0) throw Object.assign(new Error('Delivery not found'), { statusCode: 404 });
        if (!['scheduled', 'in_transit'].includes(dRows[0].status)) throw Object.assign(new Error(`Delivery is already ${dRows[0].status}`), { statusCode: 409 });

        if (dRows[0].vehicle_id) await client.query(`UPDATE delivery_vehicles SET status = 'available' WHERE id = $1`, [dRows[0].vehicle_id]);
        const { rows: updated } = await client.query(
            `UPDATE deliveries SET status = 'failed', failure_reason = $1 WHERE id = $2 RETURNING *`,
            [reason || null, dRows[0].id]
        );
        return updated[0];
    });

    await logAction({ actorUserId: req.user.id, action: 'DELIVERY_FAILED', entityType: 'DELIVERY', entityId: delivery.business_id, after: { reason } });
    res.json({ message: 'Delivery marked failed', delivery });
}

module.exports = { createVehicle, listVehicles, createDelivery, listDeliveries, dispatchDelivery, completeDelivery, failDelivery };
