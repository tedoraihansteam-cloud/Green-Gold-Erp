const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { generateForEntity, generateForEntitySafe } = require('../services/qrBarcodeService');
const { logAction } = require('../services/auditLogger');
const { createReceivable } = require('../services/receivableService');

const CYCLE_LENGTH_DAYS = { daily: 1, weekly: 7, monthly: 30, yearly: 365 };

// ---------------- Storage locations (floor/zone/room/rack/shelf/bin tree) ----------------

async function createStorageLocation(req, res) {
    const { warehouseBusinessId, parentLocationBusinessId, locationType, name, temperatureZone, capacityUnit, capacityValue } = req.body;
    const validTypes = ['FLOOR', 'ZONE', 'ROOM', 'RACK', 'SHELF', 'BIN'];
    if (!warehouseBusinessId || !locationType || !name) {
        return res.status(400).json({ error: 'warehouseBusinessId, locationType, and name are required' });
    }
    if (!validTypes.includes(locationType)) {
        return res.status(400).json({ error: `locationType must be one of: ${validTypes.join(', ')}` });
    }

    const location = await withTransaction(async (client) => {
        const { rows: whRows } = await client.query(
            `SELECT id FROM warehouses WHERE business_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
            [warehouseBusinessId, req.user.company_id]
        );
        if (whRows.length === 0) throw Object.assign(new Error('Warehouse not found'), { statusCode: 404 });

        let parentId = null;
        if (parentLocationBusinessId) {
            const { rows: parentRows } = await client.query(
                `SELECT id FROM storage_locations WHERE business_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
                [parentLocationBusinessId, req.user.company_id]
            );
            if (parentRows.length === 0) throw Object.assign(new Error('Parent location not found'), { statusCode: 404 });
            parentId = parentRows[0].id;
        }

        const businessId = await generateNextId('STORAGE_LOCATION');
        const { rows } = await client.query(
            `INSERT INTO storage_locations (business_id, company_id, warehouse_id, parent_location_id, location_type, name, temperature_zone, capacity_unit, capacity_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [businessId, req.user.company_id, whRows[0].id, parentId, locationType, name, temperatureZone || null, capacityUnit || null, capacityValue || null]
        );
        return rows[0];
    });

    await generateForEntity('STORAGE_LOCATION', location.business_id);
    await logAction({ actorUserId: req.user.id, action: 'STORAGE_LOCATION_CREATED', entityType: 'STORAGE_LOCATION', entityId: location.business_id, after: location });
    res.status(201).json({ location });
}

async function listStorageLocations(req, res) {
    const { warehouseBusinessId } = req.query;
    const { rows } = await query(
        `SELECT sl.*, w.business_id AS warehouse_business_id, parent.business_id AS parent_business_id
         FROM storage_locations sl
         JOIN warehouses w ON w.id = sl.warehouse_id
         LEFT JOIN storage_locations parent ON parent.id = sl.parent_location_id
         WHERE sl.company_id = $1 AND sl.deleted_at IS NULL
           AND ($2::text IS NULL OR w.business_id = $2)
         ORDER BY sl.created_at`,
        [req.user.company_id, warehouseBusinessId || null]
    );
    res.json({ locations: rows });
}

// ---------------- Rental policies ----------------

async function createRentalPolicy(req, res) {
    const { name, unitType, ratePerUnitPerCycle, billingCycle, minBillingCycles, gracePeriodDays, taxPercent, billingBasis='rolling' } = req.body;
    if (!name || !unitType || !ratePerUnitPerCycle || !billingCycle) {
        return res.status(400).json({ error: 'name, unitType, ratePerUnitPerCycle, and billingCycle are required' });
    }
    if (!CYCLE_LENGTH_DAYS[billingCycle]) {
        return res.status(400).json({ error: `billingCycle must be one of: ${Object.keys(CYCLE_LENGTH_DAYS).join(', ')}` });
    }

    const policy = await withTransaction(async (client) => {
        const businessId = await generateNextId('RENTAL_POLICY');
        const { rows } = await client.query(
            `INSERT INTO rental_policies (business_id, company_id, name, unit_type, rate_per_unit_per_cycle, billing_cycle, min_billing_cycles, grace_period_days, tax_percent,billing_basis)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,$10) RETURNING *`,
            [businessId, req.user.company_id, name, unitType, ratePerUnitPerCycle, billingCycle, minBillingCycles || 1, gracePeriodDays || 0, taxPercent || 0,billingBasis]
        );
        return rows[0];
    });

    await logAction({ actorUserId: req.user.id, action: 'RENTAL_POLICY_CREATED', entityType: 'RENTAL_POLICY', entityId: policy.business_id, after: policy });
    await generateForEntitySafe('RENTAL_POLICY', policy.business_id);
    res.status(201).json({ policy });
}

async function listRentalPolicies(req, res) {
    const { rows } = await query(
        `SELECT * FROM rental_policies WHERE company_id = $1 AND status = 'active' ORDER BY name`,
        [req.user.company_id]
    );
    res.json({ policies: rows });
}

// ---------------- Storage contracts ----------------

async function createContract(req, res) {
    const { customerBusinessId, storageLocationBusinessId, rentalPolicyBusinessId, unitQuantity, goodsDescription, startDate } = req.body;
    if (!customerBusinessId || !storageLocationBusinessId || !rentalPolicyBusinessId || !unitQuantity) {
        return res.status(400).json({ error: 'customerBusinessId, storageLocationBusinessId, rentalPolicyBusinessId, and unitQuantity are required' });
    }

    const contract = await withTransaction(async (client) => {
        const { rows: custRows } = await client.query(
            `SELECT id FROM master_customers WHERE business_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
            [customerBusinessId, req.user.company_id]
        );
        if (custRows.length === 0) throw Object.assign(new Error('Customer not found'), { statusCode: 404 });

        const { rows: locRows } = await client.query(
            `SELECT id FROM storage_locations WHERE business_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
            [storageLocationBusinessId, req.user.company_id]
        );
        if (locRows.length === 0) throw Object.assign(new Error('Storage location not found'), { statusCode: 404 });

        const { rows: policyRows } = await client.query(
            `SELECT id FROM rental_policies WHERE business_id = $1 AND company_id = $2`,
            [rentalPolicyBusinessId, req.user.company_id]
        );
        if (policyRows.length === 0) throw Object.assign(new Error('Rental policy not found'), { statusCode: 404 });

        const businessId = await generateNextId('COLD_STORAGE_CONTRACT');
        const { rows } = await client.query(
            `INSERT INTO storage_contracts (business_id, company_id, customer_id, storage_location_id, rental_policy_id, unit_quantity, goods_description, start_date, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, CURRENT_DATE), $9)
             RETURNING *`,
            [businessId, req.user.company_id, custRows[0].id, locRows[0].id, policyRows[0].id, unitQuantity, goodsDescription || null, startDate, req.user.id]
        );
        return rows[0];
    });

    await generateForEntity('COLD_STORAGE_CONTRACT', contract.business_id);
    await logAction({ actorUserId: req.user.id, action: 'STORAGE_CONTRACT_CREATED', entityType: 'COLD_STORAGE_CONTRACT', entityId: contract.business_id, after: contract });
    res.status(201).json({ contract });
}

async function listContracts(req, res) {
    const { status } = req.query;
    const { rows } = await query(
        `SELECT sc.*, c.business_id AS customer_business_id, c.name AS customer_name,
                sl.business_id AS storage_location_business_id, sl.name AS storage_location_name,
                rp.business_id AS rental_policy_business_id, rp.name AS rental_policy_name
         FROM storage_contracts sc
         JOIN master_customers c ON c.id = sc.customer_id
         JOIN storage_locations sl ON sl.id = sc.storage_location_id
         JOIN rental_policies rp ON rp.id = sc.rental_policy_id
         WHERE sc.company_id = $1 AND ($2::text IS NULL OR sc.status = $2)
         ORDER BY sc.created_at DESC`,
        [req.user.company_id, status || null]
    );
    res.json({ contracts: rows });
}

/**
 * The signature rule from the spec: "actual stay: 1 day, minimum charge:
 * 1 month, invoice: 1 month rental." Billing runs from the day after the
 * contract's last_billed_through (or from start_date on the first run)
 * through asOfDate. Actual elapsed time is rounded UP to whole billing
 * cycles, then whichever is larger between that and the policy's minimum
 * cycle count wins - so a contract can never bill for less than its
 * minimum even if it barely started.
 */
async function generateBilling(req, res) {
    const { businessId } = req.params;
    const asOfDate = req.body.asOfDate || new Date().toISOString().slice(0, 10);

    const result = await withTransaction(async (client) => {
        const { rows: contractRows } = await client.query(
            `SELECT sc.*, rp.rate_per_unit_per_cycle, rp.billing_cycle, rp.min_billing_cycles, rp.tax_percent, rp.billing_basis, c.credit_period_days
             FROM storage_contracts sc JOIN rental_policies rp ON rp.id = sc.rental_policy_id JOIN master_customers c ON c.id=sc.customer_id
             WHERE sc.business_id = $1 AND sc.company_id = $2 FOR UPDATE`,
            [businessId, req.user.company_id]
        );
        if (contractRows.length === 0) throw Object.assign(new Error('Contract not found'), { statusCode: 404 });
        const contract = contractRows[0];
        if (contract.status !== 'active') {
            throw Object.assign(new Error(`Contract is ${contract.status}, not active`), { statusCode: 409 });
        }

        const periodStart = contract.last_billed_through
            ? new Date(new Date(contract.last_billed_through).getTime() + 86400000)
            : new Date(contract.start_date);
        const periodEnd = new Date(asOfDate);

        if (periodEnd < periodStart) {
            throw Object.assign(new Error('asOfDate is before the start of the next billable period'), { statusCode: 400 });
        }

        const daysElapsed = Math.floor((periodEnd - periodStart) / 86400000) + 1; // inclusive
        const cycleLengthDays = CYCLE_LENGTH_DAYS[contract.billing_cycle];
        const cyclesUsed = Math.ceil(daysElapsed / cycleLengthDays);
        const billedCycles = Math.max(cyclesUsed, contract.min_billing_cycles);
        const minimumApplied = contract.min_billing_cycles > cyclesUsed;

        const billedThrough = new Date(periodStart);
        if(contract.billing_basis==='operational_year'){
            const startYear=periodStart.getUTCFullYear(),month=periodStart.getUTCMonth()+1;
            billedThrough.setUTCFullYear(month>=6?startYear+1:startYear,4,31);
        }else billedThrough.setUTCDate(billedThrough.getUTCDate()+(billedCycles*cycleLengthDays)-1);
        const billedThroughText=billedThrough.toISOString().slice(0,10);
        const subtotal = billedCycles * Number(contract.rate_per_unit_per_cycle) * Number(contract.unit_quantity);
        const taxAmount = subtotal * (Number(contract.tax_percent) / 100);
        const total = subtotal + taxAmount;

        const invoiceBusinessId = await generateNextId('COLD_STORAGE_INVOICE');
        const { rows: invoiceRows } = await client.query(
            `INSERT INTO cold_storage_invoices (business_id, company_id, contract_id, billing_period_start, billing_period_end, billed_cycles, unit_quantity, rate_used, minimum_applied, subtotal, tax_amount, total, created_by, due_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_DATE+$14)
             RETURNING *`,
            [invoiceBusinessId, req.user.company_id, contract.id, periodStart.toISOString().slice(0, 10), billedThroughText, billedCycles, contract.unit_quantity, contract.rate_per_unit_per_cycle, minimumApplied, subtotal, taxAmount, total, req.user.id, contract.credit_period_days]
        );

        await createReceivable(client,{companyId:req.user.company_id,customerId:contract.customer_id,sourceType:'COLD_STORAGE_INVOICE',sourceId:invoiceBusinessId,description:`Cold storage invoice ${invoiceBusinessId}`,amount:total,dueDate:invoiceRows[0].due_date});

        await client.query(`UPDATE storage_contracts SET last_billed_through = $1 WHERE id = $2`, [billedThroughText, contract.id]);

        return invoiceRows[0];
    });

    await generateForEntity('COLD_STORAGE_INVOICE', result.business_id);
    await logAction({ actorUserId: req.user.id, action: 'COLD_STORAGE_BILLED', entityType: 'COLD_STORAGE_INVOICE', entityId: result.business_id, after: result });
    await generateForEntitySafe('COLD_STORAGE_INVOICE', result.business_id);
    res.status(201).json({ invoice: result, financialInvoiceBusinessId:`FIN-${result.business_id}` });
}

async function closeContract(req, res) {
    const { rows } = await query(
        `UPDATE storage_contracts SET status = 'closed', end_date = CURRENT_DATE, closed_at = now(), closed_by = $1
         WHERE business_id = $2 AND company_id = $3 AND status = 'active'
         RETURNING *`,
        [req.user.id, req.params.businessId, req.user.company_id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Contract not found or not active' });
    await logAction({ actorUserId: req.user.id, action: 'STORAGE_CONTRACT_CLOSED', entityType: 'COLD_STORAGE_CONTRACT', entityId: rows[0].business_id });
    res.json({ message: 'Contract closed - remember to run a final billing if it hasn\'t been billed through today', contract: rows[0] });
}

async function createLaborCharge(req, res) {
    const { contractBusinessId, deliveryBusinessId, customerBusinessId, chargeType, description, quantity, rate, chargeDate } = req.body;
    if (!chargeType || !quantity || Number(quantity) <= 0 || rate == null || Number(rate) < 0) {
        return res.status(400).json({ error: 'chargeType, positive quantity and non-negative rate are required' });
    }
    const charge = await withTransaction(async (client) => {
        let customerId = null;
        let contractId = null;
        let deliveryId = null;
        if (contractBusinessId) {
            const { rows } = await client.query(`SELECT id, customer_id FROM storage_contracts WHERE business_id=$1 AND company_id=$2`, [contractBusinessId, req.user.company_id]);
            if (!rows.length) throw Object.assign(new Error('Contract not found'), { statusCode: 404 });
            contractId = rows[0].id; customerId = rows[0].customer_id;
        }
        if (deliveryBusinessId) {
            const { rows } = await client.query(`SELECT id, customer_id FROM deliveries WHERE business_id=$1 AND company_id=$2`, [deliveryBusinessId, req.user.company_id]);
            if (!rows.length) throw Object.assign(new Error('Delivery not found'), { statusCode: 404 });
            deliveryId = rows[0].id; customerId = rows[0].customer_id;
        }
        if (!customerId && customerBusinessId) {
            const { rows } = await client.query(`SELECT id FROM master_customers WHERE business_id=$1 AND company_id=$2`, [customerBusinessId, req.user.company_id]);
            if (!rows.length) throw Object.assign(new Error('Customer not found'), { statusCode: 404 });
            customerId = rows[0].id;
        }
        if (!customerId) throw Object.assign(new Error('A contract, delivery or customer is required'), { statusCode: 400 });
        const businessId = await generateNextId('CUSTOMER_CHARGE');
        const amount = Number(quantity) * Number(rate);
        const { rows } = await client.query(
            `INSERT INTO customer_charges(business_id,company_id,customer_id,contract_id,delivery_id,charge_type,description,quantity,rate,amount,charge_date,created_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,CURRENT_DATE),$12) RETURNING *`,
            [businessId,req.user.company_id,customerId,contractId,deliveryId,chargeType,description||null,quantity,rate,amount,chargeDate,req.user.id]
        );
        const { rows: customers } = await client.query(`SELECT credit_period_days FROM master_customers WHERE id=$1`, [customerId]);
        const dueDate = new Date(Date.now() + Number(customers[0].credit_period_days) * 86400000).toISOString().slice(0, 10);
        await createReceivable(client,{companyId:req.user.company_id,customerId,sourceType:'CUSTOMER_CHARGE',sourceId:businessId,description:description||chargeType.replace(/_/g,' '),amount,dueDate});
        return rows[0];
    });
    await generateForEntitySafe('CUSTOMER_CHARGE', charge.business_id);
    await logAction({actorUserId:req.user.id,action:'CUSTOMER_CHARGE_CREATED',entityType:'CUSTOMER_CHARGE',entityId:charge.business_id,after:charge});
    res.status(201).json({ charge });
}

async function listLaborCharges(req, res) {
    const { rows } = await query(
        `SELECT cc.*, c.business_id AS customer_business_id, c.name AS customer_name,
                sc.business_id AS contract_business_id, d.business_id AS delivery_business_id
         FROM customer_charges cc JOIN master_customers c ON c.id=cc.customer_id
         LEFT JOIN storage_contracts sc ON sc.id=cc.contract_id LEFT JOIN deliveries d ON d.id=cc.delivery_id
         WHERE cc.company_id=$1 ORDER BY cc.created_at DESC`, [req.user.company_id]
    );
    res.json({ charges: rows });
}

module.exports = {
    createStorageLocation, listStorageLocations, createRentalPolicy, listRentalPolicies,
    createContract, listContracts, generateBilling, closeContract, createLaborCharge, listLaborCharges
};
