const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { generateForEntity } = require('../services/qrBarcodeService');
const { logAction } = require('../services/auditLogger');

// ---------------- Warehouses ----------------

async function createWarehouse(req, res) {
    const { name, branchId, locationNotes } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const warehouse = await withTransaction(async (client) => {
        const businessId = await generateNextId('WAREHOUSE');
        const { rows } = await client.query(
            `INSERT INTO warehouses (business_id, company_id, branch_id, name, location_notes)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [businessId, req.user.company_id, branchId || null, name, locationNotes || null]
        );
        return rows[0];
    });

    await generateForEntity('WAREHOUSE', warehouse.business_id);
    await logAction({ actorUserId: req.user.id, action: 'WAREHOUSE_CREATED', entityType: 'WAREHOUSE', entityId: warehouse.business_id, after: warehouse });
    res.status(201).json({ warehouse });
}

async function listWarehouses(req, res) {
    const { rows } = await query(
        `SELECT * FROM warehouses WHERE company_id = $1 AND deleted_at IS NULL ORDER BY name`,
        [req.user.company_id]
    );
    res.json({ warehouses: rows });
}

// ---------------- Products ----------------

async function createProduct(req, res) {
    const { name, sku, category, unit, unitPrice, monthlyRentPerUnit, reorderLevel } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const product = await withTransaction(async (client) => {
        const businessId = await generateNextId('PRODUCT');
        const { rows } = await client.query(
            `INSERT INTO products (business_id, company_id, name, sku, category, unit, unit_price, monthly_rent_per_unit, reorder_level)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [businessId, req.user.company_id, name, sku || null, category || null, unit || 'pcs', unitPrice || 0, monthlyRentPerUnit || 0, reorderLevel || 0]
        );
        return rows[0];
    });

    await generateForEntity('PRODUCT', product.business_id);
    await logAction({ actorUserId: req.user.id, action: 'PRODUCT_CREATED', entityType: 'PRODUCT', entityId: product.business_id, after: product });
    res.status(201).json({ product });
}

async function listProducts(req, res) {
    const { rows } = await query(
        `SELECT p.*,
                COALESCE(sb_total.total_quantity, 0) AS total_stock
         FROM products p
         LEFT JOIN (
             SELECT product_id, sum(quantity) AS total_quantity
             FROM stock_balances GROUP BY product_id
         ) sb_total ON sb_total.product_id = p.id
         WHERE p.company_id = $1 AND p.deleted_at IS NULL
         ORDER BY p.created_at DESC`,
        [req.user.company_id]
    );
    res.json({ products: rows });
}

// ---------------- Stock movements ----------------

/**
 * Records a stock movement and keeps stock_balances in sync, all inside
 * the caller's transaction. This is the one place that touches
 * stock_ledger + stock_balances together so the two can never drift apart.
 */
async function recordStockMovement(client, { productId, warehouseId, movementType, quantity, referenceType, referenceId, createdBy, notes }) {
    const direction = movementType === 'OUT' || movementType === 'TRANSFER_OUT' ? -1 : 1;
    const delta = direction * Number(quantity);

    const { rows: balanceRows } = await client.query(
        `INSERT INTO stock_balances (product_id, warehouse_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (product_id, warehouse_id)
         DO UPDATE SET quantity = stock_balances.quantity + $3, updated_at = now()
         RETURNING quantity`,
        [productId, warehouseId, delta]
    );
    const newBalance = balanceRows[0].quantity;

    if (newBalance < 0) {
        throw Object.assign(new Error('Insufficient stock for this movement'), { statusCode: 409 });
    }

    await client.query(
        `INSERT INTO stock_ledger (product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, balance_after, created_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [productId, warehouseId, movementType, quantity, referenceType || null, referenceId || null, newBalance, createdBy || null, notes || null]
    );

    return newBalance;
}

async function stockIn(req, res) {
    const { productId, warehouseId, quantity, referenceType, notes } = req.body;
    if (!productId || !warehouseId || !quantity) {
        return res.status(400).json({ error: 'productId, warehouseId, and quantity are required' });
    }
    if (Number(quantity) <= 0) {
        return res.status(400).json({ error: 'quantity must be positive' });
    }

    const newBalance = await withTransaction((client) =>
        recordStockMovement(client, {
            productId, warehouseId, movementType: 'IN', quantity,
            referenceType: referenceType || 'OPENING_BALANCE', createdBy: req.user.id, notes
        })
    );

    await logAction({
        actorUserId: req.user.id, action: 'STOCK_IN', entityType: 'PRODUCT', entityId: productId,
        after: { warehouseId, quantity, newBalance }
    });

    res.status(201).json({ message: 'Stock recorded', newBalance });
}

async function getStockBalances(req, res) {
    const { warehouseId } = req.query;
    const { rows } = await query(
        `SELECT sb.product_id, p.business_id AS product_business_id, p.name AS product_name, p.unit,
                sb.warehouse_id, w.business_id AS warehouse_business_id, w.name AS warehouse_name,
                sb.quantity
         FROM stock_balances sb
         JOIN products p ON p.id = sb.product_id
         JOIN warehouses w ON w.id = sb.warehouse_id
         WHERE p.company_id = $1 AND ($2::uuid IS NULL OR sb.warehouse_id = $2)
         ORDER BY p.name`,
        [req.user.company_id, warehouseId || null]
    );
    res.json({ balances: rows });
}

module.exports = { createWarehouse, listWarehouses, createProduct, listProducts, stockIn, getStockBalances, recordStockMovement };
