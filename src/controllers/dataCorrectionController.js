const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { logAction } = require('../services/auditLogger');
const { recordAccountTransaction } = require('./accountController');
const { recordStockMovement } = require('./inventoryController');
const { cancelReceivable } = require('../services/receivableService');

const MASTER_ACTIONS = ['EDIT', 'DELETE', 'RESTORE', 'CANCEL'];
const DRAFT_ACTIONS = ['EDIT', 'DELETE', 'RESTORE', 'CANCEL'];
const POSTED_ACTIONS = ['DELETE', 'RESTORE', 'CANCEL', 'REVERSE'];
const REGISTRY = {
    CUSTOMER: { table: 'master_customers', fields: ['name', 'phone', 'email', 'address', 'customer_type', 'entity_kind'], softDelete: true, status: true, actions: MASTER_ACTIONS },
    VENDOR: { table: 'master_vendors', fields: ['name', 'phone', 'email', 'address', 'vendor_type', 'status'], softDelete: true, status: true, actions: MASTER_ACTIONS },
    PRODUCT: { table: 'products', fields: ['name', 'sku', 'category', 'unit', 'unit_price', 'reorder_level', 'status'], softDelete: true, status: true, actions: MASTER_ACTIONS },
    WAREHOUSE: { table: 'warehouses', fields: ['name', 'location_notes'], softDelete: true, actions: MASTER_ACTIONS },
    EMPLOYEE: { table: 'master_employees', fields: ['full_name', 'designation', 'phone', 'email', 'join_date', 'status'], softDelete: true, status: true, actions: MASTER_ACTIONS },
    MACHINE: { table: 'machines', fields: ['name', 'machine_type', 'model', 'installed_date', 'status'], softDelete: true, status: true, actions: MASTER_ACTIONS },
    VEHICLE: { table: 'delivery_vehicles', fields: ['vehicle_number', 'vehicle_type', 'capacity_unit', 'capacity_value', 'driver_name', 'driver_phone', 'status'], softDelete: true, status: true, actions: MASTER_ACTIONS },
    STORAGE_LOCATION: { table: 'storage_locations', fields: ['name', 'location_type', 'temperature_zone', 'capacity_unit', 'capacity_value', 'status'], softDelete: true, status: true, actions: MASTER_ACTIONS },
    PURCHASE_REQUISITION: { table: 'purchase_requisitions', fields: ['title', 'justification', 'priority', 'required_date', 'destination_name'], draftStatuses: ['draft', 'submitted', 'returned'], actions: DRAFT_ACTIONS, restoreStatus: 'draft', cancelStatus: 'rejected' },
    PORTAL_REQUEST: { table: 'portal_requests', fields: ['subject', 'body', 'requested_date', 'amount'], draftStatuses: ['draft', 'submitted', 'returned'], actions: DRAFT_ACTIONS, restoreStatus: 'draft' },
    BILL_SUBMISSION: { table: 'bill_submissions', fields: ['bill_number', 'bill_date', 'category', 'payee', 'amount', 'description'], draftStatuses: ['draft', 'returned'], actions: DRAFT_ACTIONS, restoreStatus: 'draft', cancelStatus: 'rejected' },
    PURCHASE_ORDER: { table: 'purchase_orders', protected: true, actions: POSTED_ACTIONS, restoreStatus: 'issued' },
    SALES_INVOICE: { table: 'sales_invoices', protected: true, actions: POSTED_ACTIONS },
    FINANCIAL_INVOICE: { table: 'unified_invoices', protected: true, actions: POSTED_ACTIONS },
    ACCOUNT_TRANSACTION: { table: 'account_transactions', protected: true, idColumn: 'id', actions: POSTED_ACTIONS },
    PAYROLL: { table: 'payroll_runs', protected: true, actions: POSTED_ACTIONS },
    GOODS_RECEIPT: { table: 'goods_receipts', protected: true, actions: POSTED_ACTIONS },
    DELIVERY: { table: 'deliveries', protected: true, actions: POSTED_ACTIONS, restoreStatus: 'scheduled' },
    GATE_PASS: { table: 'gate_passes', protected: true, actions: POSTED_ACTIONS, restoreStatus: 'issued' },
    CUSTOMER_PAYMENT: { table: 'customer_payments', protected: true, actions: POSTED_ACTIONS }
};

const safeType = (value) => String(value || '').trim().toUpperCase();
const error = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
function cleanChanges(config, input) { const changes = {}; for (const key of config.fields || []) if (Object.prototype.hasOwnProperty.call(input || {}, key)) changes[key] = input[key] === '' ? null : input[key]; return changes; }
function effectiveOperation(config, requested) {
    if (requested !== 'DELETE' || !config.protected) return requested;
    return ['ACCOUNT_TRANSACTION', 'CUSTOMER_PAYMENT', 'SALES_INVOICE', 'PAYROLL', 'GOODS_RECEIPT'].includes(config.type) ? 'REVERSE' : 'CANCEL';
}
async function findRecord(client, config, businessId, companyId, lock = false) {
    if (config.type === 'ACCOUNT_TRANSACTION') {
        return (await client.query(`SELECT at.*,a.company_id,a.business_id account_business_id FROM account_transactions at JOIN accounts a ON a.id=at.account_id WHERE at.id::text=$1 AND a.company_id=$2${lock ? ' FOR UPDATE OF at' : ''}`, [businessId, companyId])).rows[0];
    }
    const id = config.idColumn || 'business_id';
    return (await client.query(`SELECT * FROM ${config.table} WHERE ${id}::text=$1 AND company_id=$2${lock ? ' FOR UPDATE' : ''}`, [businessId, companyId])).rows[0];
}
async function countDependency(client, sql, params, label, blocking = false) {
    const count = Number((await client.query(sql, params)).rows[0]?.count || 0);
    return { label, count, blocking: Boolean(blocking && count), level: blocking && count ? 'block' : count ? 'warning' : 'clear' };
}
async function dependencyChecks(client, type, record, companyId, operation) {
    const checks = [];
    if (type === 'CUSTOMER') {
        checks.push(await countDependency(client, `SELECT count(*) FROM customer_receivables WHERE customer_id=$1 AND status IN('unpaid','partial')`, [record.id], 'Outstanding receivables'));
        checks.push(await countDependency(client, `SELECT count(*) FROM storage_contracts WHERE customer_id=$1 AND status='active'`, [record.id], 'Active rental contracts'));
        checks.push(await countDependency(client, `SELECT count(*) FROM product_batches WHERE owner_customer_id=$1 AND available_quantity>0`, [record.id], 'Stored product batches'));
    } else if (type === 'VENDOR') {
        checks.push(await countDependency(client, `SELECT count(*) FROM purchase_orders WHERE vendor_id=$1 AND status NOT IN('received','cancelled')`, [record.id], 'Open purchase orders'));
        checks.push(await countDependency(client, `SELECT count(*) FROM bill_submissions WHERE vendor_id=$1 AND status NOT IN('paid','accepted','rejected')`, [record.id], 'Open vendor bills'));
    } else if (type === 'PRODUCT') {
        checks.push(await countDependency(client, `SELECT count(*) FROM stock_balances WHERE product_id=$1 AND quantity<>0`, [record.id], 'Warehouses with stock', operation === 'DELETE'));
        checks.push(await countDependency(client, `SELECT count(*) FROM product_batches WHERE product_id=$1 AND available_quantity>0`, [record.id], 'Available product batches', operation === 'DELETE'));
    } else if (type === 'WAREHOUSE') {
        checks.push(await countDependency(client, `SELECT count(*) FROM stock_balances WHERE warehouse_id=$1 AND quantity<>0`, [record.id], 'Products with warehouse stock', operation === 'DELETE'));
    } else if (type === 'STORAGE_LOCATION') {
        checks.push(await countDependency(client, `SELECT count(*) FROM batch_location_balances WHERE location_id=$1 AND quantity>0`, [record.id], 'Batches assigned to location', operation === 'DELETE'));
    } else if (type === 'MACHINE') {
        checks.push(await countDependency(client, `SELECT count(*) FROM machine_incidents WHERE machine_id=$1 AND status<>'resolved'`, [record.id], 'Open machine incidents'));
    } else if (type === 'PURCHASE_ORDER') {
        checks.push({ label: 'Vendor payments', count: Number(record.amount_paid || 0), blocking: Number(record.amount_paid || 0) > 0, level: Number(record.amount_paid || 0) > 0 ? 'block' : 'clear', unit: 'amount' });
        checks.push(await countDependency(client, `SELECT count(*) FROM purchase_order_receipts WHERE purchase_order_id=$1`, [record.id], 'Goods receipts', true));
    }
    return checks;
}
async function metadata(req, res) {
    res.json({ entities: Object.entries(REGISTRY).map(([type, value]) => ({ type, editableFields: value.fields || [], softDelete: Boolean(value.softDelete), protected: Boolean(value.protected), draftOnly: Boolean(value.draftStatuses), allowedActions: value.actions })) });
}
async function list(req, res) {
    const reviewer = req.permissions.has('USER_MANAGEMENT_APPROVE'), { status, entityType } = req.query;
    const { rows } = await query(`SELECT dcr.*,ru.username requested_by_username,vu.username reviewed_by_username,au.username applied_by_username FROM data_correction_requests dcr JOIN users ru ON ru.id=dcr.requested_by LEFT JOIN users vu ON vu.id=dcr.reviewed_by LEFT JOIN users au ON au.id=dcr.applied_by WHERE dcr.company_id=$1 AND ($2::boolean OR dcr.requested_by=$3) AND ($4::text IS NULL OR dcr.status=$4) AND ($5::text IS NULL OR dcr.entity_type=$5) ORDER BY dcr.requested_at DESC`, [req.user.company_id, reviewer, req.user.id, status || null, entityType ? safeType(entityType) : null]);
    res.json({ requests: rows, reviewer });
}
async function detail(req, res) {
    const reviewer = req.permissions.has('USER_MANAGEMENT_APPROVE');
    const record = (await query(`SELECT dcr.*,ru.username requested_by_username,vu.username reviewed_by_username,au.username applied_by_username FROM data_correction_requests dcr JOIN users ru ON ru.id=dcr.requested_by LEFT JOIN users vu ON vu.id=dcr.reviewed_by LEFT JOIN users au ON au.id=dcr.applied_by WHERE dcr.business_id=$1 AND dcr.company_id=$2 AND ($3::boolean OR dcr.requested_by=$4)`, [req.params.businessId, req.user.company_id, reviewer, req.user.id])).rows[0];
    if (!record) return res.status(404).json({ error: 'Correction request not found' });
    const config = REGISTRY[record.entity_type]; config.type = record.entity_type;
    const targetRecord = await findRecord({ query }, config, record.entity_business_id, req.user.company_id);
    const [history, dependencies] = await Promise.all([
        query(`SELECT al.*,u.username actor_username FROM audit_logs al LEFT JOIN users u ON u.id=al.actor_user_id WHERE al.entity_type=$1 AND al.entity_id=$2 ORDER BY al.created_at DESC LIMIT 200`, [record.entity_type, record.entity_business_id]),
        targetRecord ? dependencyChecks({ query }, record.entity_type, targetRecord, req.user.company_id, record.operation) : Promise.resolve([])
    ]);
    res.json({ request: record, targetRecord, dependencies, recordHistory: history.rows, reviewer, moduleAction: { allowedActions: config.actions, effectiveOperation: effectiveOperation(config, record.operation), canApply: reviewer && record.status === 'module_action_required' } });
}
async function entityHistory(req, res) {
    const type = safeType(req.params.entityType), config = REGISTRY[type]; if (!config) return res.status(400).json({ error: 'Unsupported entity type' });
    const [corrections, audit] = await Promise.all([query(`SELECT dcr.*,u.username requested_by_username FROM data_correction_requests dcr JOIN users u ON u.id=dcr.requested_by WHERE dcr.company_id=$1 AND dcr.entity_type=$2 AND dcr.entity_business_id=$3 ORDER BY requested_at DESC`, [req.user.company_id, type, req.params.entityBusinessId]), query(`SELECT al.*,u.username actor_username FROM audit_logs al LEFT JOIN users u ON u.id=al.actor_user_id WHERE al.entity_type=$1 AND al.entity_id=$2 ORDER BY al.created_at DESC LIMIT 200`, [type, req.params.entityBusinessId])]);
    res.json({ corrections: corrections.rows, audit: audit.rows });
}
async function create(req, res) {
    const type = safeType(req.body.entityType), operation = safeType(req.body.operation), config = REGISTRY[type], reason = String(req.body.reason || '').trim();
    if (!config) return res.status(400).json({ error: 'Unsupported entity type' }); config.type = type;
    if (!config.actions.includes(operation) || !reason) return res.status(400).json({ error: 'Select a supported action and enter the reason' });
    const current = await findRecord({ query }, config, req.body.entityBusinessId, req.user.company_id); if (!current) return res.status(404).json({ error: 'Record not found' });
    const changes = cleanChanges(config, req.body.proposedChanges); if (operation === 'EDIT' && !Object.keys(changes).length) return res.status(400).json({ error: 'At least one permitted field change is required' });
    const businessId = await generateNextId('DATA_CORRECTION');
    const row = (await query(`INSERT INTO data_correction_requests(business_id,company_id,entity_type,entity_business_id,operation,effective_operation,proposed_changes,reason,requested_by,before_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [businessId, req.user.company_id, type, req.body.entityBusinessId, operation, effectiveOperation(config, operation), JSON.stringify(changes), reason, req.user.id, JSON.stringify(current)])).rows[0];
    await logAction({ actorUserId: req.user.id, action: 'DATA_CORRECTION_REQUESTED', entityType: type, entityId: req.body.entityBusinessId, before: current, after: { correctionBusinessId: businessId, operation, changes, reason } });
    res.status(201).json({ request: row });
}
async function review(req, res) {
    const decision = String(req.body.decision || '').toLowerCase(), notes = String(req.body.notes || '').trim();
    if (!['approve', 'reject'].includes(decision) || !notes) return res.status(400).json({ error: 'Decision and review notes are required' });
    const result = await withTransaction(async (client) => {
        const correction = (await client.query(`SELECT * FROM data_correction_requests WHERE business_id=$1 AND company_id=$2 AND status='submitted' FOR UPDATE`, [req.params.businessId, req.user.company_id])).rows[0];
        if (!correction) throw error('Correction request is not pending');
        if (decision === 'reject') return (await client.query(`UPDATE data_correction_requests SET status='rejected',reviewed_by=$1,reviewed_at=now(),review_notes=$2 WHERE id=$3 RETURNING *`, [req.user.id, notes, correction.id])).rows[0];
        const config = REGISTRY[correction.entity_type]; config.type = correction.entity_type;
        const current = await findRecord(client, config, correction.entity_business_id, req.user.company_id, true); if (!current) throw error('Target record no longer exists', 404);
        const dependencies = await dependencyChecks(client, correction.entity_type, current, req.user.company_id, correction.operation);
        return (await client.query(`UPDATE data_correction_requests SET status='module_action_required',reviewed_by=$1,reviewed_at=now(),review_notes=$2,before_data=$3,effective_operation=$4,dependency_snapshot=$5::jsonb WHERE id=$6 RETURNING *`, [req.user.id, notes, JSON.stringify(current), effectiveOperation(config, correction.operation), JSON.stringify(dependencies), correction.id])).rows[0];
    });
    await logAction({ actorUserId: req.user.id, action: `DATA_CORRECTION_${result.status.toUpperCase()}`, entityType: result.entity_type, entityId: result.entity_business_id, before: result.before_data, after: { correctionBusinessId: result.business_id, operation: result.operation, notes } });
    res.json({ request: result });
}
async function applyMasterAction(client, correction, config, current) {
    if (correction.operation === 'EDIT') {
        const changes = cleanChanges(config, correction.proposed_changes), keys = Object.keys(changes); if (!keys.length) throw error('No approved field changes were provided');
        const assignments = keys.map((key, index) => `${key}=$${index + 1}`).join(',');
        return (await client.query(`UPDATE ${config.table} SET ${assignments} WHERE business_id=$${keys.length + 1} AND company_id=$${keys.length + 2} RETURNING *`, [...keys.map((key) => changes[key]), correction.entity_business_id, correction.company_id])).rows[0];
    }
    if (correction.operation === 'RESTORE') {
        if (config.softDelete) return (await client.query(`UPDATE ${config.table} SET deleted_at=NULL${config.status ? `,status=$1` : ''} WHERE business_id=$${config.status ? 2 : 1} AND company_id=$${config.status ? 3 : 2} RETURNING *`, config.status ? [config.restoreStatus || 'active', correction.entity_business_id, correction.company_id] : [correction.entity_business_id, correction.company_id])).rows[0];
        if (config.restoreStatus) return (await client.query(`UPDATE ${config.table} SET status=$1 WHERE business_id=$2 AND company_id=$3 RETURNING *`, [config.restoreStatus, correction.entity_business_id, correction.company_id])).rows[0];
        throw error('This record cannot be restored automatically');
    }
    if (config.softDelete) return (await client.query(`UPDATE ${config.table} SET deleted_at=now()${config.status ? `,status='inactive'` : ''} WHERE business_id=$1 AND company_id=$2 RETURNING *`, [correction.entity_business_id, correction.company_id])).rows[0];
    if (config.draftStatuses) {
        if (!config.draftStatuses.includes(String(current.status || 'draft'))) throw error(`Record status '${current.status}' must be reversed by its operational module`);
        return (await client.query(`UPDATE ${config.table} SET status=$1 WHERE business_id=$2 AND company_id=$3 RETURNING *`, [config.cancelStatus || 'cancelled', correction.entity_business_id, correction.company_id])).rows[0];
    }
    throw error('No safe module action is configured for this record');
}
async function reverseAccountTransaction(client, correction, current, user) {
    if ((await client.query(`SELECT 1 FROM account_transactions WHERE reference_type='DATA_CORRECTION_REVERSAL' AND reference_id=$1`, [correction.business_id])).rows.length) throw error('This transaction was already reversed');
    const withdrawal = ['WITHDRAWAL', 'TRANSFER_OUT'].includes(current.transaction_type);
    await recordAccountTransaction(client, { accountId: current.account_id, transactionType: withdrawal ? 'DEPOSIT' : 'WITHDRAWAL', amount: current.amount, referenceType: 'DATA_CORRECTION_REVERSAL', referenceId: correction.business_id, createdBy: user.id, notes: `${correction.reason}; reversal of transaction ${current.id}` });
    return { originalTransactionId: current.id, correctionStatus: 'reversed', reversalReference: correction.business_id };
}
async function reverseCustomerPayment(client, correction, current, user) {
    if (current.payment_status === 'bounced' || current.payment_status === 'reversed') throw error('Customer payment is already reversed or bounced');
    const allocations = (await client.query(`SELECT * FROM customer_payment_allocations WHERE payment_id=$1`, [current.id])).rows;
    for (const allocation of allocations) await client.query(`UPDATE customer_receivables SET paid_amount=GREATEST(paid_amount-$1,0),status=CASE WHEN GREATEST(paid_amount-$1,0)=0 THEN 'unpaid' ELSE 'partial' END WHERE id=$2`, [allocation.amount, allocation.receivable_id]);
    await recordAccountTransaction(client, { accountId: current.account_id, transactionType: 'WITHDRAWAL', amount: current.amount, referenceType: 'PAYMENT_REVERSAL', referenceId: correction.business_id, createdBy: user.id, notes: correction.reason });
    return (await client.query(`UPDATE customer_payments SET payment_status='reversed',bounced_at=now(),bounced_by=$1,bounced_reason=$2 WHERE id=$3 RETURNING *`, [user.id, correction.reason, current.id])).rows[0];
}
async function reverseSalesInvoice(client, correction, current, user) {
    if (current.status === 'cancelled') throw error('Sales invoice is already cancelled');
    const items = (await client.query(`SELECT * FROM sales_invoice_items WHERE invoice_id=$1`, [current.id])).rows;
    for (const item of items) {
        await recordStockMovement(client, { productId: item.product_id, warehouseId: current.warehouse_id, movementType: 'IN', quantity: item.quantity, referenceType: 'DATA_CORRECTION_REVERSAL', referenceId: correction.business_id, createdBy: user.id, notes: correction.reason });
        if (item.batch_id) {
            const movements = (await client.query(`SELECT from_location_id,quantity FROM batch_movements WHERE batch_id=$1 AND reference_type='SALE' AND reference_id=$2 AND movement_type='OUT' FOR UPDATE`, [item.batch_id, current.business_id])).rows;
            for (const movement of movements) {
                if (movement.from_location_id) await client.query(`INSERT INTO batch_location_balances(batch_id,location_id,quantity) VALUES($1,$2,$3) ON CONFLICT(batch_id,location_id) DO UPDATE SET quantity=batch_location_balances.quantity+EXCLUDED.quantity,updated_at=now()`, [item.batch_id, movement.from_location_id, movement.quantity]);
                await client.query(`INSERT INTO batch_movements(batch_id,to_location_id,movement_type,quantity,reference_type,reference_id,created_by,notes) VALUES($1,$2,'RETURN',$3,'DATA_CORRECTION_REVERSAL',$4,$5,$6)`, [item.batch_id, movement.from_location_id, movement.quantity, correction.business_id, user.id, correction.reason]);
                await client.query(`UPDATE product_batch_units SET status='stored',location_id=$1 WHERE id IN(SELECT id FROM product_batch_units WHERE batch_id=$2 AND status='delivered' ORDER BY unit_number LIMIT $3)`, [movement.from_location_id, item.batch_id, Math.floor(Number(movement.quantity))]);
            }
            await client.query(`UPDATE product_batches SET available_quantity=available_quantity+$1,status='available' WHERE id=$2`, [item.quantity, item.batch_id]);
        }
    }
    if (current.payment_status === 'legacy' && current.payment_account_id) await recordAccountTransaction(client, { accountId: current.payment_account_id, transactionType: 'WITHDRAWAL', amount: current.total, referenceType: 'INVOICE_CANCELLATION', referenceId: correction.business_id, createdBy: user.id, notes: correction.reason });
    else await cancelReceivable(client, 'SALES_INVOICE', current.business_id);
    return (await client.query(`UPDATE sales_invoices SET status='cancelled',payment_status='cancelled',cancelled_at=now(),cancelled_by=$1,cancel_reason=$2 WHERE id=$3 RETURNING *`, [user.id, correction.reason, current.id])).rows[0];
}
async function applyProtectedAction(client, correction, config, current, user) {
    const operation = correction.effective_operation || effectiveOperation(config, correction.operation);
    if (operation === 'RESTORE') {
        if (!config.restoreStatus) throw error('A reversed financial, stock or payroll record cannot be restored. Create a new approved operational record instead.');
        if (correction.entity_type === 'PURCHASE_ORDER' && Number(current.amount_paid) > 0) throw error('A paid purchase order cannot be restored automatically');
        return (await client.query(`UPDATE ${config.table} SET status=$1 WHERE business_id=$2 AND company_id=$3 RETURNING *`, [config.restoreStatus, correction.entity_business_id, correction.company_id])).rows[0];
    }
    if (correction.entity_type === 'ACCOUNT_TRANSACTION') return reverseAccountTransaction(client, correction, current, user);
    if (correction.entity_type === 'CUSTOMER_PAYMENT') return reverseCustomerPayment(client, correction, current, user);
    if (correction.entity_type === 'SALES_INVOICE') return reverseSalesInvoice(client, correction, current, user);
    if (correction.entity_type === 'PURCHASE_ORDER') {
        if (Number(current.amount_paid) > 0) throw error('Purchase order has payments. Complete a vendor refund workflow before cancellation.');
        if ((await client.query(`SELECT count(*) FROM purchase_order_receipts WHERE purchase_order_id=$1`, [current.id])).rows[0].count !== '0') throw error('Purchase order has received goods and cannot be cancelled without reversing its receipts');
        return (await client.query(`UPDATE purchase_orders SET status='cancelled',cancelled_at=now(),cancelled_by=$1,cancel_reason=$2 WHERE id=$3 RETURNING *`, [user.id, correction.reason, current.id])).rows[0];
    }
    if (correction.entity_type === 'GATE_PASS') {
        if (current.status === 'exited') throw error('An exited gate pass cannot be cancelled; create a corrective entry instead');
        return (await client.query(`UPDATE gate_passes SET status='cancelled',cancelled_at=now(),cancelled_by=$1,cancel_reason=$2 WHERE id=$3 RETURNING *`, [user.id, correction.reason, current.id])).rows[0];
    }
    if (correction.entity_type === 'DELIVERY') {
        if (current.status === 'delivered') throw error('A completed delivery requires a return workflow, not deletion');
        return (await client.query(`UPDATE deliveries SET status='cancelled',failure_reason=$1 WHERE id=$2 RETURNING *`, [correction.reason, current.id])).rows[0];
    }
    if (correction.entity_type === 'FINANCIAL_INVOICE') return (await client.query(`UPDATE unified_invoices SET status='cancelled' WHERE id=$1 RETURNING *`, [current.id])).rows[0];
    if (correction.entity_type === 'PAYROLL') {
        if (current.status === 'processed' && current.paying_account_id) {
            const total = Number((await client.query(`SELECT COALESCE(sum(net_pay),0) total FROM payroll_items WHERE payroll_run_id=$1`, [current.id])).rows[0].total);
            if (total > 0) await recordAccountTransaction(client, { accountId: current.paying_account_id, transactionType: 'DEPOSIT', amount: total, referenceType: 'DATA_CORRECTION_REVERSAL', referenceId: correction.business_id, createdBy: user.id, notes: correction.reason });
        }
        return (await client.query(`UPDATE payroll_runs SET status='reversed' WHERE id=$1 RETURNING *`, [current.id])).rows[0];
    }
    if (correction.entity_type === 'GOODS_RECEIPT') {
        const batch = (await client.query(`SELECT * FROM product_batches WHERE id=$1 FOR UPDATE`, [current.batch_id])).rows[0];
        if (!batch || Number(batch.available_quantity) !== Number(current.received_quantity)) throw error('Goods have moved or been delivered. Reverse those movements before cancelling the GRN.');
        await recordStockMovement(client, { productId: batch.product_id, warehouseId: current.warehouse_id, movementType: 'OUT', quantity: current.received_quantity, referenceType: 'DATA_CORRECTION_REVERSAL', referenceId: correction.business_id, createdBy: user.id, notes: correction.reason });
        const locations = (await client.query(`SELECT * FROM batch_location_balances WHERE batch_id=$1 AND quantity>0 FOR UPDATE`, [batch.id])).rows;
        for (const location of locations) await client.query(`INSERT INTO batch_movements(batch_id,from_location_id,movement_type,quantity,reference_type,reference_id,created_by,notes) VALUES($1,$2,'REVERSAL',$3,'DATA_CORRECTION_REVERSAL',$4,$5,$6)`, [batch.id, location.location_id, location.quantity, correction.business_id, user.id, correction.reason]);
        await client.query(`UPDATE batch_location_balances SET quantity=0,updated_at=now() WHERE batch_id=$1`, [batch.id]);
        await client.query(`UPDATE product_batch_units SET status='cancelled',location_id=NULL WHERE batch_id=$1 AND status IN('received','stored')`, [batch.id]);
        await client.query(`UPDATE product_batches SET available_quantity=0,status='cancelled' WHERE id=$1`, [batch.id]);
        return (await client.query(`UPDATE goods_receipts SET correction_status='cancelled' WHERE id=$1 RETURNING *`, [current.id])).rows[0];
    }
    throw error('This module action needs a dedicated operational reversal workflow');
}
async function applyModuleAction(req, res) {
    const notes = String(req.body.notes || '').trim(); if (!notes) return res.status(400).json({ error: 'Module action remarks are required' });
    const result = await withTransaction(async (client) => {
        const correction = (await client.query(`SELECT * FROM data_correction_requests WHERE business_id=$1 AND company_id=$2 AND status='module_action_required' FOR UPDATE`, [req.params.businessId, req.user.company_id])).rows[0];
        if (!correction) throw error('Approved module action request was not found');
        const config = REGISTRY[correction.entity_type]; config.type = correction.entity_type;
        const current = await findRecord(client, config, correction.entity_business_id, req.user.company_id, true); if (!current) throw error('Target record no longer exists', 404);
        const dependencies = await dependencyChecks(client, correction.entity_type, current, req.user.company_id, correction.operation);
        const blockers = dependencies.filter((item) => item.blocking); if (blockers.length) throw error(`Resolve before applying: ${blockers.map((item) => item.label).join(', ')}`);
        const after = config.protected ? await applyProtectedAction(client, correction, config, current, req.user) : await applyMasterAction(client, correction, config, current);
        return (await client.query(`UPDATE data_correction_requests SET status='applied',applied_by=$1,applied_at=now(),module_action_notes=$2,before_data=$3,after_data=$4,module_action_result=$5::jsonb,dependency_snapshot=$6::jsonb WHERE id=$7 RETURNING *`, [req.user.id, notes, JSON.stringify(current), JSON.stringify(after), JSON.stringify({ requestedOperation: correction.operation, effectiveOperation: correction.effective_operation, applied: true }), JSON.stringify(dependencies), correction.id])).rows[0];
    });
    await logAction({ actorUserId: req.user.id, action: 'DATA_CORRECTION_MODULE_ACTION_APPLIED', entityType: result.entity_type, entityId: result.entity_business_id, before: result.before_data, after: { correctionBusinessId: result.business_id, operation: result.operation, effectiveOperation: result.effective_operation, result: result.after_data, notes } });
    res.json({ request: result, message: `${result.effective_operation || result.operation} applied successfully` });
}

module.exports = { metadata, list, detail, entityHistory, create, review, applyModuleAction };
