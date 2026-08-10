const { query } = require('../config/db');
const { verifyQrPayload } = require('../services/qrBarcodeService');
const { logAction } = require('../services/auditLogger');

const ROUTES = {
    ACCOUNT: '/accounts/{id}', CUSTOMER: '/customers/{id}', VENDOR: '/vendors/{id}', EMPLOYEE: '/employees',
    PRODUCT: '/inventory/products', WAREHOUSE: '/inventory/warehouses', INVOICE: '/invoices/{id}',
    GATE_PASS: '/gate-passes', MACHINE: '/manufacturing/machines/{id}/history',
    MACHINE_INCIDENT: '/manufacturing/incidents', DELIVERY: '/logistics/deliveries',
    VEHICLE: '/logistics/vehicles', EXPENSE: '/expenses', BUDGET: '/budgets',
    PAYROLL_RUN: '/hr/payroll', SALARY_TEMPLATE: '/hr/salary-templates',
    STORAGE_LOCATION: '/cold-storage/locations', RENTAL_POLICY: '/cold-storage/policies',
    COLD_STORAGE_CONTRACT: '/cold-storage/contracts', COLD_STORAGE_INVOICE: '/cold-storage/contracts',
    PRODUCT_BATCH:'/inventory/batches?batch={id}', PRODUCT_UNIT:'/inventory/batches?unit={id}', CUSTOMER_CHARGE:'/accounts/receivables', CUSTOMER_PAYMENT:'/accounts/receivables', GOODS_RECEIPT:'/inventory/batches', BILL_SUBMISSION:'/bills', MONEY_RECEIPT:'/accounts/receivables', PAYMENT_VOUCHER:'/bills', STOCK_RELEASE:'/inventory/batches'
};
const VIEW_PERMISSIONS = {
    ACCOUNT:'ACCOUNTS_VIEW', CUSTOMER:'SALES_VIEW', VENDOR:'INVENTORY_VIEW', EMPLOYEE:'HR_VIEW', PRODUCT:'INVENTORY_VIEW',
    WAREHOUSE:'INVENTORY_VIEW', DELIVERY:'LOGISTICS_VIEW', VEHICLE:'LOGISTICS_VIEW', EXPENSE:'ACCOUNTS_VIEW', BUDGET:'BUDGET_VIEW',
    PAYROLL_RUN:'HR_VIEW', SALARY_TEMPLATE:'HR_VIEW', STORAGE_LOCATION:'COLD_STORAGE_VIEW', RENTAL_POLICY:'COLD_STORAGE_VIEW',
    COLD_STORAGE_CONTRACT:'COLD_STORAGE_VIEW', COLD_STORAGE_INVOICE:'COLD_STORAGE_VIEW', MACHINE_INCIDENT:'MANUFACTURING_VIEW',
    PRODUCT_BATCH:'INVENTORY_VIEW', PRODUCT_UNIT:'INVENTORY_VIEW', CUSTOMER_CHARGE:'ACCOUNTS_VIEW', CUSTOMER_PAYMENT:'ACCOUNTS_VIEW', GOODS_RECEIPT:'INVENTORY_VIEW', BILL_SUBMISSION:'ACCOUNTS_VIEW', MONEY_RECEIPT:'ACCOUNTS_VIEW', PAYMENT_VOUCHER:'ACCOUNTS_VIEW', STOCK_RELEASE:'INVENTORY_VIEW'
};

function actionsFor(type, id, permissions) {
    if(type==='FINANCIAL_INVOICE')return ['SALES_VIEW','COLD_STORAGE_VIEW','INVENTORY_VIEW','LOGISTICS_VIEW','ACCOUNTS_VIEW'].some(code=>permissions.has(code))?[{code:'VIEW_INLINE',label:'Scanned financial invoice'}]:[];
    if (type === 'MACHINE') return permissions.has('MANUFACTURING_VIEW') ? [{ code: 'VIEW', label: 'Open 2-year machine history', route: `/manufacturing/machines/${encodeURIComponent(id)}/history` }] : [];
    if (type === 'GATE_PASS') return permissions.has('SECURITY_VIEW') ? [{ code: 'VIEW_INLINE', label: 'Scanned gate pass' }] : [];
    if (type === 'INVOICE') return permissions.has('SALES_VIEW') ? [{ code: 'VIEW', label: 'Open invoice', route: `/invoices/${encodeURIComponent(id)}` }] : [];
    if(type==='PRODUCT')return permissions.has('INVENTORY_VIEW')?[{code:'VIEW_INLINE',label:'Scanned product'}]:[];
    if(type==='PRODUCT_BATCH'||type==='PRODUCT_UNIT')return [
        permissions.has('INVENTORY_VIEW')&&{code:'VIEW_INLINE',label:'Scanned stock identity'},
        permissions.has('INVENTORY_EDIT')&&{code:'ADD_LOCATION',label:'Add product to location'},
        permissions.has('INVENTORY_EDIT')&&{code:'TRANSFER',label:'Transfer product'}
    ].filter(Boolean);
    if(type==='STORAGE_LOCATION')return [permissions.has('COLD_STORAGE_VIEW')&&{code:'VIEW_INLINE',label:'Scanned location'},permissions.has('INVENTORY_EDIT')&&{code:'ADD_PRODUCT',label:'Add product'}].filter(Boolean);
    const permission = VIEW_PERMISSIONS[type];
    return !permission || permissions.has(permission) ? [{ code: 'VIEW_INLINE', label: 'Scanned record' }] : [];
}

async function scannedRecord(type, id, companyId) {
    const lookups = {
        PRODUCT: [`SELECT business_id,name,category,unit,sku,monthly_rent_per_unit FROM products WHERE business_id=$1 AND company_id=$2 AND deleted_at IS NULL`, []],
        PRODUCT_BATCH: [`SELECT pb.business_id,p.name AS product_name,p.business_id AS product_business_id,p.unit,pb.lot_number,pb.received_quantity,pb.available_quantity,pb.status,pb.received_at,COALESCE(json_agg(json_build_object('businessId',sl.business_id,'name',sl.name,'quantity',blb.quantity)) FILTER(WHERE blb.quantity>0),'[]') AS locations FROM product_batches pb JOIN products p ON p.id=pb.product_id LEFT JOIN batch_location_balances blb ON blb.batch_id=pb.id LEFT JOIN storage_locations sl ON sl.id=blb.location_id WHERE pb.business_id=$1 AND pb.company_id=$2 GROUP BY pb.id,p.id`, []],
        PRODUCT_UNIT: [`SELECT pbu.business_id,pbu.status,pb.business_id AS batch_business_id,p.name AS product_name,p.unit,sl.business_id AS location_business_id,sl.name AS location_name FROM product_batch_units pbu JOIN product_batches pb ON pb.id=pbu.batch_id JOIN products p ON p.id=pb.product_id LEFT JOIN storage_locations sl ON sl.id=pbu.location_id WHERE pbu.business_id=$1 AND pb.company_id=$2`, []],
        STORAGE_LOCATION: [`SELECT sl.business_id,sl.name,sl.location_type,sl.temperature_zone,sl.capacity_unit,sl.capacity_value,w.business_id AS warehouse_business_id,w.name AS warehouse_name,(SELECT count(*)::int FROM batch_location_balances blb WHERE blb.location_id=sl.id AND blb.quantity>0) AS batch_count,(SELECT COALESCE(sum(blb.quantity),0) FROM batch_location_balances blb WHERE blb.location_id=sl.id) AS stored_quantity FROM storage_locations sl JOIN warehouses w ON w.id=sl.warehouse_id WHERE sl.business_id=$1 AND sl.company_id=$2 AND sl.deleted_at IS NULL`, []],
        WAREHOUSE: [`SELECT business_id,name,address FROM warehouses WHERE business_id=$1 AND company_id=$2 AND deleted_at IS NULL`, []],
        MACHINE: [`SELECT m.business_id,m.name,m.machine_type,m.status,m.model,m.installed_date,m.total_running_hours,w.name AS warehouse_name FROM machines m LEFT JOIN warehouses w ON w.id=m.warehouse_id WHERE m.business_id=$1 AND m.company_id=$2 AND m.deleted_at IS NULL`, []],
        EMPLOYEE: [`SELECT e.business_id,e.full_name,e.designation,d.name AS department,e.status FROM master_employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.business_id=$1 AND e.company_id=$2 AND e.deleted_at IS NULL`, []],
        CUSTOMER: [`SELECT business_id,name,phone,email,address FROM master_customers WHERE business_id=$1 AND company_id=$2 AND deleted_at IS NULL`, []],
        VENDOR: [`SELECT business_id,name,phone,email,address FROM master_vendors WHERE business_id=$1 AND company_id=$2 AND deleted_at IS NULL`, []],
        GATE_PASS: [`SELECT business_id,pass_type,status,description,vehicle_number,contact_name,contact_phone,created_at,exit_confirmed_at,exit_note FROM gate_passes WHERE business_id=$1 AND company_id=$2`, []],
        INVOICE: [`SELECT i.business_id,i.status,i.total,i.created_at,c.name AS customer_name FROM sales_invoices i JOIN master_customers c ON c.id=i.customer_id WHERE i.business_id=$1 AND i.company_id=$2`, []],
        FINANCIAL_INVOICE: [`SELECT ui.business_id,ui.invoice_type,ui.source_id,ui.current_total,ui.previous_due_snapshot,ui.total_payable_snapshot,ui.status,ui.issued_at,c.name customer_name FROM unified_invoices ui LEFT JOIN master_customers c ON c.id=ui.customer_id WHERE ui.business_id=$1 AND ui.company_id=$2`, []]
    };
    const lookup = lookups[type];
    if (!lookup) return { business_id: id };
    const { rows } = await query(lookup[0], [id, companyId]);
    return rows[0] || { business_id: id };
}

async function resolve(req, res) {
    const raw = String(req.body.rawPayload || req.body.businessId || '').trim();
    if (!raw) return res.status(400).json({ error: 'Scanned QR/barcode value is required' });
    let entityType;
    let businessId;
    let signed = false;
    if (raw.startsWith('{')) {
        const verified = verifyQrPayload(raw);
        if (!verified.valid) return res.status(400).json({ error: verified.reason });
        entityType = verified.entityType;
        businessId = verified.businessId;
        signed = true;
    } else {
        const { rows } = await query(
            `SELECT entity_type, entity_id FROM qr_barcode_records WHERE entity_id = $1 ORDER BY entity_type LIMIT 2`, [raw]
        );
        if (!rows.length && raw.startsWith('FIN-')) { const central=await query(`SELECT business_id FROM unified_invoices WHERE business_id=$1 AND company_id=$2`,[raw,req.user.company_id]);if(central.rows.length){entityType='FINANCIAL_INVOICE';businessId=raw;} }
        if (!rows.length && !entityType) return res.status(404).json({ error: 'No ERP record matches this code' });
        if(entityType==='FINANCIAL_INVOICE'){
            // Central invoice barcodes are generated on demand and do not need a stored image record.
        } else {
        if (rows.length > 1) return res.status(409).json({ error: 'This ID is ambiguous; scan its signed QR code instead' });
        entityType = rows[0].entity_type;
        businessId = rows[0].entity_id;
        }
    }
    const exists = entityType==='FINANCIAL_INVOICE' ? await query(`SELECT 1 FROM unified_invoices WHERE business_id=$1 AND company_id=$2`,[businessId,req.user.company_id]) : await query(`SELECT 1 FROM qr_barcode_records WHERE entity_type = $1 AND entity_id = $2`, [entityType, businessId]);
    if (!exists.rows.length) return res.status(404).json({ error: 'Identifier exists in the code but not in this ERP' });
    await logAction({ actorUserId: req.user.id, action: 'IDENTIFIER_SCANNED', entityType, entityId: businessId, after: { signed } });
    const record = await scannedRecord(entityType, businessId, req.user.company_id);
    const actions = actionsFor(entityType, businessId, req.permissions);
    if (entityType === 'GATE_PASS' && record.status === 'issued' && req.permissions.has('SECURITY_APPROVE')) {
        actions.push({ code: 'CONFIRM_EXIT', label: 'Exit & submit exit note' });
    }
    if (!actions.length) return res.status(403).json({ error: 'You do not have permission to open this record' });
    res.json({ entityType, businessId, signed, record, actions });
}

module.exports = { resolve };
