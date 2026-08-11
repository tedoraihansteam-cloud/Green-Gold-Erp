const fs = require('fs');
const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { generateForEntitySafe } = require('../services/qrBarcodeService');
const { analyzeFile, recalculateStructuredReview, recalculateMultiDomainReview } = require('../services/universalImportService');
const { recordStockMovement } = require('./inventoryController');
const { recordAccountTransaction } = require('./accountController');
const { createReceivable } = require('../services/receivableService');

function deleteTemporaryUpload(filePath) {
    if (!filePath) return;
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); }
    catch (error) { console.error(`Temporary import cleanup failed for ${filePath}:`, error.message); }
}

function validateFlatRows(job, map) {
    const errors = [];
    if (!map.name) return [{ row: null, field: 'name', message: 'Name mapping is required' }];
    job.preview_rows.forEach((raw, index) => {
        const value = raw[map.name];
        if (!value || !String(value).trim()) errors.push({ row: index + 2, field: 'name', message: 'Name is required' });
        if (map.email && raw[map.email] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw[map.email]))) errors.push({ row: index + 2, field: 'email', message: 'Invalid email' });
        for (const field of ['unitPrice', 'monthlyRentPerUnit']) if (map[field] && raw[map[field]] !== '' && !Number.isFinite(Number(raw[map[field]]))) errors.push({ row: index + 2, field, message: 'Must be numeric' });
    });
    return errors.slice(0, 200);
}
async function reviewContext(job, companyId) {
    if (job.extraction_result?.mode === 'multi_domain') {
        const [warehouses, locations, accounts, customers, vendors, employees, departments, sites, duplicateUploads] = await Promise.all([
            query(`SELECT business_id,name FROM warehouses WHERE company_id=$1 AND deleted_at IS NULL ORDER BY name`, [companyId]),
            query(`SELECT sl.business_id,sl.name,sl.location_type,w.business_id warehouse_business_id,w.name warehouse_name FROM storage_locations sl JOIN warehouses w ON w.id=sl.warehouse_id WHERE sl.company_id=$1 AND sl.deleted_at IS NULL ORDER BY w.name,sl.name`, [companyId]),
            query(`SELECT business_id,name,account_type,current_balance FROM accounts WHERE company_id=$1 AND deleted_at IS NULL AND status='active' ORDER BY account_type,name`, [companyId]),
            query(`SELECT business_id,name,phone FROM master_customers WHERE company_id=$1 AND deleted_at IS NULL ORDER BY name`, [companyId]),
            query(`SELECT business_id,name,phone FROM master_vendors WHERE company_id=$1 AND deleted_at IS NULL ORDER BY name`, [companyId]),
            query(`SELECT business_id,full_name,designation FROM master_employees WHERE company_id=$1 AND deleted_at IS NULL ORDER BY full_name`, [companyId]),
            query(`SELECT d.business_id,d.name,b.name branch_name FROM departments d JOIN branches b ON b.id=d.branch_id WHERE b.company_id=$1 AND d.status='active' ORDER BY b.name,d.name`, [companyId]),
            query(`SELECT id,name,site_type,address FROM company_sites WHERE company_id=$1 ORDER BY name`, [companyId]),
            job.source_summary?.sourceHash ? query(`SELECT business_id,original_name,status,created_at FROM bulk_import_jobs WHERE company_id=$1 AND id<>$2 AND source_summary->>'sourceHash'=$3 ORDER BY created_at DESC LIMIT 10`, [companyId, job.id, job.source_summary.sourceHash]) : Promise.resolve({ rows: [] })
        ]);
        return { ...job, review_context: {
            warehouses: warehouses.rows, locations: locations.rows, accounts: accounts.rows,
            customers: customers.rows, vendors: vendors.rows, employees: employees.rows,
            departments: departments.rows, sites: sites.rows, duplicateUploads: duplicateUploads.rows,
            postingLocked: true,
            postingMessage: 'Demo safety lock is active. Saving this review does not create or change ERP operational records.'
        } };
    }
    if (job.extraction_result?.mode !== 'structured') {
        if (job.import_type !== 'customer') return job;
        const { rows: customers } = await query(`SELECT business_id,name,phone FROM master_customers WHERE company_id=$1 AND deleted_at IS NULL ORDER BY name`, [companyId]);
        const map = job.field_mapping || {}, matches = (job.preview_rows || []).map((raw, index) => {
            const name = map.name ? String(raw[map.name] || '').trim() : '', phone = map.phone ? String(raw[map.phone] || '').trim() : '';
            const found = customers.find((customer) => customer.name.toLowerCase() === name.toLowerCase() || (phone && String(customer.phone || '').includes(phone)));
            return { row: index + 2, name, phone, status: found ? 'registered' : 'new', businessId: found?.business_id || null };
        });
        return { ...job, review_context: { customerMatches: matches, registeredCount: matches.filter((item) => item.status === 'registered').length, newCount: matches.filter((item) => item.status === 'new').length } };
    }
    const [warehouses, locations, accounts, customers] = await Promise.all([
        query(`SELECT business_id,name FROM warehouses WHERE company_id=$1 AND deleted_at IS NULL ORDER BY name`, [companyId]),
        query(`SELECT sl.business_id,sl.name,sl.location_type,w.business_id warehouse_business_id,w.name warehouse_name FROM storage_locations sl JOIN warehouses w ON w.id=sl.warehouse_id WHERE sl.company_id=$1 AND sl.deleted_at IS NULL ORDER BY w.name,sl.name`, [companyId]),
        query(`SELECT business_id,name,account_type,current_balance FROM accounts WHERE company_id=$1 AND deleted_at IS NULL AND status='active' ORDER BY account_type,name`, [companyId]),
        query(`SELECT business_id,name,phone FROM master_customers WHERE company_id=$1 AND deleted_at IS NULL ORDER BY name`, [companyId])
    ]);
    const detected = job.extraction_result.customer;
    const detectedPhones = detected?.phones?.length ? detected.phones : String(detected?.phone || '').match(/(?:\+?88)?01\d{9}/g) || [];
    const match = customers.rows.find((row) => row.name.toLowerCase() === String(detected?.name || '').toLowerCase() || detectedPhones.some((phone) => String(row.phone || '').includes(phone)));
    const suggestedWarehouse = warehouses.rows.length === 1 ? warehouses.rows[0] : null;
    const eligibleLocations = suggestedWarehouse ? locations.rows.filter((row) => row.warehouse_business_id === suggestedWarehouse.business_id) : locations.rows;
    const suggestedLocation = eligibleLocations.length === 1 ? eligibleLocations[0] : null;
    const cashInHand = accounts.rows.find((row) => row.account_type === 'cash' && /cash\s*(in\s*)?hand/i.test(row.name));
    const suggestedAccount = cashInHand || (accounts.rows.length === 1 ? accounts.rows[0] : null);
    return { ...job, review_context: {
        warehouses: warehouses.rows, locations: locations.rows, accounts: accounts.rows, customers: customers.rows,
        customerMatch: match ? { status: 'registered', businessId: match.business_id, name: match.name, phone: match.phone } : { status: 'new', businessId: null, name: detected?.name, phone: detected?.phone },
        suggestedCustomerBusinessId: match?.business_id || null, suggestedWarehouseBusinessId: suggestedWarehouse?.business_id || null,
        suggestedLocationBusinessId: suggestedLocation?.business_id || null, suggestedAccountBusinessId: suggestedAccount?.business_id || null
    } };
}
async function upload(req, res) {
    if (!req.file) return res.status(400).json({ error: 'File is required' });
    try {
        const requestedType = req.body.importType || 'auto';
        if (!['auto', 'customer', 'product', 'vendor', 'staff', 'payroll', 'accounts', 'stock_report', 'raw_material_report', 'document'].includes(requestedType)) return res.status(400).json({ error: 'Select a supported master-data, department-data, report, or auto-detect option' });
        const analysis = await analyzeFile(req.file, requestedType);
        if (analysis.previewRows.length > 10000) return res.status(400).json({ error: 'A bulk file can contain at most 10,000 rows' });
        const businessId = await generateNextId('BULK_IMPORT');
        const { rows } = await query(
            `INSERT INTO bulk_import_jobs(business_id,company_id,import_type,original_name,file_path,detected_columns,preview_rows,field_mapping,validation_errors,detected_document_type,extraction_result,routing_plan,source_summary,created_by)
             VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9::jsonb,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14) RETURNING *`,
            [businessId, req.user.company_id, analysis.importType, req.file.originalname, '', JSON.stringify(analysis.columns), JSON.stringify(analysis.previewRows), analysis.fieldMapping, JSON.stringify(analysis.validationErrors), analysis.detectedDocumentType, JSON.stringify(analysis.extractionResult), JSON.stringify(analysis.routingPlan), JSON.stringify(analysis.sourceSummary), req.user.id]
        );
        res.status(201).json({ job: await reviewContext(rows[0], req.user.company_id) });
    } catch (error) {
        throw error;
    } finally {
        deleteTemporaryUpload(req.file?.path);
    }
}
async function list(req, res) {
    const { rows } = await query(`SELECT id,business_id,import_type,detected_document_type,original_name,status,detected_columns,field_mapping,validation_errors,source_summary,routing_plan,created_at,submitted_at,CASE WHEN jsonb_array_length(preview_rows)>0 THEN jsonb_array_length(preview_rows) ELSE COALESCE((source_summary->>'records')::int,(source_summary->>'goodsReceipts')::int,0) END row_count FROM bulk_import_jobs WHERE company_id=$1 ORDER BY created_at DESC`, [req.user.company_id]);
    res.json({ jobs: rows });
}
async function get(req, res) {
    const { rows } = await query(`SELECT * FROM bulk_import_jobs WHERE business_id=$1 AND company_id=$2`, [req.params.businessId, req.user.company_id]);
    if (!rows.length) return res.status(404).json({ error: 'Import job not found' });
    res.json({ job: await reviewContext(rows[0], req.user.company_id) });
}
async function updateReview(req, res) {
    const current = (await query(`SELECT * FROM bulk_import_jobs WHERE business_id=$1 AND company_id=$2 AND status='review'`, [req.params.businessId, req.user.company_id])).rows[0];
    if (!current) return res.status(404).json({ error: 'Review job not found' });
    let revised = null;
    if (req.body.extractionResult && current.extraction_result?.mode === 'structured') revised = recalculateStructuredReview(req.body.extractionResult);
    if (req.body.extractionResult && current.extraction_result?.mode === 'multi_domain') revised = recalculateMultiDomainReview(req.body.extractionResult);
    const { rows } = await query(`UPDATE bulk_import_jobs SET field_mapping=COALESCE($1,field_mapping),submission_options=COALESCE($2,submission_options),extraction_result=COALESCE($3::jsonb,extraction_result),source_summary=COALESCE($4::jsonb,source_summary),routing_plan=COALESCE($5::jsonb,routing_plan),validation_errors=COALESCE($6::jsonb,validation_errors) WHERE id=$7 AND status='review' RETURNING *`, [req.body.fieldMapping || null, req.body.submissionOptions || null, revised ? JSON.stringify(revised.extractionResult) : null, revised ? JSON.stringify(revised.sourceSummary) : null, revised ? JSON.stringify(revised.routingPlan) : null, revised ? JSON.stringify(revised.validationErrors) : null, current.id]);
    if (!rows.length) return res.status(404).json({ error: 'Review job not found' });
    res.json({ job: await reviewContext(rows[0], req.user.company_id) });
}
async function submitFlat(client, job, user) {
    const map = job.field_mapping;
    const errors = validateFlatRows(job, map);
    if (errors.length) return { errors };
    const generated = [];
    let created = 0, matched = 0;
    for (const raw of job.preview_rows) {
        const value = Object.fromEntries(Object.entries(map).map(([target, source]) => [target, source ? String(raw[source] ?? '').trim() : null]));
        const module = job.import_type === 'customer' ? 'CUSTOMER' : job.import_type === 'product' ? 'PRODUCT' : 'VENDOR';
        let existing = null;
        if (job.import_type === 'customer') existing = (await client.query(`SELECT business_id FROM master_customers WHERE company_id=$1 AND deleted_at IS NULL AND (lower(name)=lower($2) OR ($3::text IS NOT NULL AND phone LIKE '%'||$3||'%')) LIMIT 1`, [user.company_id, value.name, value.phone || null])).rows[0];
        if (job.import_type === 'product') existing = (await client.query(`SELECT business_id FROM products WHERE company_id=$1 AND deleted_at IS NULL AND (lower(name)=lower($2) OR ($3::text IS NOT NULL AND sku=$3)) LIMIT 1`, [user.company_id, value.name, value.sku || null])).rows[0];
        if (job.import_type === 'vendor') existing = (await client.query(`SELECT business_id FROM master_vendors WHERE company_id=$1 AND deleted_at IS NULL AND (lower(name)=lower($2) OR ($3::text IS NOT NULL AND phone LIKE '%'||$3||'%')) LIMIT 1`, [user.company_id, value.name, value.phone || null])).rows[0];
        if (existing) { matched++; continue; }
        const code = await generateNextId(module);
        if (job.import_type === 'customer') await client.query(`INSERT INTO master_customers(business_id,company_id,name,phone,email,address,customer_type) VALUES($1,$2,$3,$4,$5,$6,$7)`, [code, user.company_id, value.name, value.phone || null, value.email || null, value.address || null, value.customerType || null]);
        if (job.import_type === 'product') await client.query(`INSERT INTO products(business_id,company_id,name,sku,category,unit,unit_price,monthly_rent_per_unit) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [code, user.company_id, value.name, value.sku || null, value.category || null, value.unit || 'pcs', Number(value.unitPrice) || 0, Number(value.monthlyRentPerUnit) || 0]);
        if (job.import_type === 'vendor') await client.query(`INSERT INTO master_vendors(business_id,company_id,name,phone,email,address,vendor_type) VALUES($1,$2,$3,$4,$5,$6,$7)`, [code, user.company_id, value.name, value.phone || null, value.email || null, value.address || null, value.vendorType || null]);
        generated.push({ type: module, code }); created++;
    }
    return { imported: job.preview_rows.length, generated, summary: { [job.import_type]: job.preview_rows.length, created, matchedExisting: matched } };
}
async function posting(client, jobId, recordType, externalKey, targetType, targetId, details = {}) {
    await client.query(`INSERT INTO bulk_import_postings(job_id,record_type,external_key,target_entity_type,target_entity_id,details) VALUES($1,$2,$3,$4,$5,$6)`, [jobId, recordType, externalKey, targetType, targetId, details]);
}
async function charge(client, { job, user, customerId, receipt, type, amount, description, chargeDate }) {
    if (amount <= 0) return null;
    const businessId = await generateNextId('CUSTOMER_CHARGE');
    await client.query(`INSERT INTO customer_charges(business_id,company_id,customer_id,charge_type,description,quantity,rate,amount,charge_date,created_by) VALUES($1,$2,$3,$4,$5,1,$6,$6,$7,$8)`, [businessId, user.company_id, customerId, type, description, amount, chargeDate, user.id]);
    const receivable = await createReceivable(client, { companyId: user.company_id, customerId, sourceType: 'CUSTOMER_CHARGE', sourceId: businessId, description, amount, dueDate: chargeDate });
    await posting(client, job.id, 'customer_charge', `${receipt.externalReference}:${type}`, 'CUSTOMER_CHARGE', businessId, { amount });
    return { businessId, receivableId: receivable.id };
}
async function submitStructured(client, job, user) {
    const data = job.extraction_result;
    const options = job.submission_options || {};
    const errors = (job.validation_errors || []).filter((item) => item.severity !== 'warning');
    if (!options.locationBusinessId && !options.warehouseBusinessId) errors.push({ field: 'warehouse', message: 'Select a receiving warehouse or storage location' });
    if ((data.payments || []).length && !options.accountBusinessId) errors.push({ field: 'account', message: 'Select the cash or bank account that received these payments' });
    if ((data.reconciliation || []).some((check) => check.status !== 'matched') && !options.confirmAdjustments) errors.push({ field: 'reconciliation', message: 'Confirm the edited values before final submission' });
    if (errors.length) return { errors };
    const location = options.locationBusinessId ? (await client.query(`SELECT id,warehouse_id FROM storage_locations WHERE business_id=$1 AND company_id=$2 AND deleted_at IS NULL`, [options.locationBusinessId, user.company_id])).rows[0] : null;
    const warehouse = location ? { id: location.warehouse_id } : (await client.query(`SELECT id FROM warehouses WHERE business_id=$1 AND company_id=$2 AND deleted_at IS NULL`, [options.warehouseBusinessId, user.company_id])).rows[0];
    const account = options.accountBusinessId ? (await client.query(`SELECT id FROM accounts WHERE business_id=$1 AND company_id=$2 AND deleted_at IS NULL AND status='active'`, [options.accountBusinessId, user.company_id])).rows[0] : null;
    if (!warehouse) return { errors: [{ field: 'warehouse', message: 'Selected receiving warehouse/location was not found' }] };
    if ((data.payments || []).length && !account) return { errors: [{ field: 'account', message: 'Selected receiving account was not found' }] };
    let customer = options.customerBusinessId ? (await client.query(`SELECT * FROM master_customers WHERE business_id=$1 AND company_id=$2`, [options.customerBusinessId, user.company_id])).rows[0] : null;
    if (!customer) customer = (await client.query(`SELECT * FROM master_customers WHERE company_id=$1 AND lower(name)=lower($2) AND deleted_at IS NULL LIMIT 1`, [user.company_id, data.customer.name])).rows[0];
    if (!customer) for (const phone of data.customer.phones || []) { customer = (await client.query(`SELECT * FROM master_customers WHERE company_id=$1 AND phone LIKE '%'||$2||'%' AND deleted_at IS NULL LIMIT 1`, [user.company_id, phone])).rows[0]; if (customer) break; }
    const generated = [];
    if (!customer) {
        const businessId = await generateNextId('CUSTOMER');
        customer = (await client.query(`INSERT INTO master_customers(business_id,company_id,name,phone,address,customer_type,entity_kind) VALUES($1,$2,$3,$4,$5,$6,'organization') RETURNING *`, [businessId, user.company_id, data.customer.name, data.customer.phone || null, data.customer.address || null, data.customer.customerType || 'cold_storage_client'])).rows[0];
        generated.push({ type: 'CUSTOMER', code: businessId });
    }
    await posting(client, job.id, 'customer', data.customer.name, 'CUSTOMER', customer.business_id, { matched: !generated.some((item) => item.type === 'CUSTOMER') });
    const products = new Map();
    for (const source of data.products || []) {
        let product = (await client.query(`SELECT * FROM products WHERE company_id=$1 AND lower(name)=lower($2) AND deleted_at IS NULL LIMIT 1`, [user.company_id, source.name])).rows[0];
        if (!product) {
            const businessId = await generateNextId('PRODUCT');
            product = (await client.query(`INSERT INTO products(business_id,company_id,name,category,unit) VALUES($1,$2,$3,$4,$5) RETURNING *`, [businessId, user.company_id, source.name, source.category || null, source.unit || 'lot'])).rows[0];
            generated.push({ type: 'PRODUCT', code: businessId });
        }
        products.set(source.name.toLowerCase(), product);
        await posting(client, job.id, 'product', source.name, 'PRODUCT', product.business_id);
    }
    const batches = new Map();
    const summary = { customers: 1, products: products.size, goodsReceipts: 0, deliveries: 0, charges: 0, payments: 0, units: 0 };
    const importedReceivableIds = [];
    for (const receipt of data.goodsReceipts || []) {
        const duplicate = (await client.query(`SELECT business_id FROM product_batches WHERE company_id=$1 AND source_reference=$2`, [user.company_id, receipt.externalReference])).rows[0];
        if (duplicate) throw Object.assign(new Error(`Dalil ${receipt.externalReference} was already imported as ${duplicate.business_id}`), { statusCode: 409 });
        const product = products.get(receipt.productName.toLowerCase());
        const batchBusinessId = await generateNextId('PRODUCT_BATCH');
        const batch = (await client.query(
            `INSERT INTO product_batches(business_id,company_id,product_id,owner_customer_id,lot_number,source_reference,received_quantity,available_quantity,status,receiving_warehouse_id,rent_per_unit_per_cycle,billing_cycle,received_at,located_at,last_rent_billed_through,created_by)
             VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,'monthly',$11,$12,$13,$14) RETURNING *`,
            [batchBusinessId, user.company_id, product.id, customer.id, receipt.externalReference, receipt.totalLots, receipt.remainingQuantity, receipt.remainingQuantity > 0 ? (location ? 'available' : 'received') : 'dispatched', warehouse.id, receipt.rentRatePerLot, receipt.receivedDate, location && receipt.remainingQuantity > 0 ? receipt.receivedDate : null, receipt.billedThroughDate || receipt.receivedDate, user.id]
        )).rows[0];
        batches.set(receipt.externalReference, batch);
        if (location && receipt.remainingQuantity > 0) await client.query(`INSERT INTO batch_location_balances(batch_id,location_id,quantity) VALUES($1,$2,$3)`, [batch.id, location.id, receipt.remainingQuantity]);
        await client.query(`INSERT INTO batch_movements(batch_id,to_location_id,movement_type,quantity,reference_type,reference_id,created_by,created_at) VALUES($1,$2,'RECEIPT',$3,'BULK_IMPORT',$4,$5,$6)`, [batch.id, location?.id || null, receipt.totalLots, job.business_id, user.id, receipt.receivedDate]);
        await recordStockMovement(client, { productId: product.id, warehouseId: warehouse.id, movementType: 'IN', quantity: receipt.totalLots, referenceType: 'BULK_IMPORT_RECEIPT', referenceId: batchBusinessId, createdBy: user.id, notes: `Imported from ${job.original_name}; Dalil ${receipt.externalReference}` });
        const unitStatus = location ? 'stored' : 'received';
        await client.query(`INSERT INTO product_batch_units(batch_id,unit_number,business_id,status,location_id) SELECT $1::uuid,n,$2||'-U'||lpad(n::text,6,'0'),CASE WHEN n<=$3 THEN 'delivered' ELSE $4 END,CASE WHEN n<=$3 THEN NULL::uuid ELSE $5::uuid END FROM generate_series(1,$6::int) n`, [batch.id, batchBusinessId, Math.floor(receipt.deliveredQuantity), unitStatus, location?.id || null, Math.floor(receipt.totalLots)]);
        const grnBusinessId = await generateNextId('GOODS_RECEIPT');
        await client.query(`INSERT INTO goods_receipts(business_id,company_id,batch_id,customer_id,warehouse_id,received_quantity,rent_rate,billing_cycle,labor_amount,condition_notes,acknowledgement_name,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'monthly',$8,$9,$10,$11,$12)`, [grnBusinessId, user.company_id, batch.id, customer.id, warehouse.id, receipt.totalLots, receipt.rentRatePerKg, receipt.laborAmount, `Imported ledger: ${receipt.totalKg} kg (${receipt.kgPerLot} kg per lot)`, data.customer.contactName || null, user.id, receipt.receivedDate]);
        await posting(client, job.id, 'goods_receipt', receipt.externalReference, 'GOODS_RECEIPT', grnBusinessId, receipt);
        generated.push({ type: 'PRODUCT_BATCH', code: batchBusinessId }, { type: 'GOODS_RECEIPT', code: grnBusinessId });
        const laborId = await charge(client, { job, user, customerId: customer.id, receipt, type: 'RECEIVING_LABOR', amount: receipt.laborAmount, description: `Receiving labor - Dalil ${receipt.externalReference}`, chargeDate: receipt.receivedDate });
        const rentId = await charge(client, { job, user, customerId: customer.id, receipt, type: 'STORAGE_RENT', amount: receipt.rentAmount, description: `First month storage rent - Dalil ${receipt.externalReference}`, chargeDate: receipt.receivedDate });
        if (laborId) { generated.push({ type: 'CUSTOMER_CHARGE', code: laborId.businessId }); importedReceivableIds.push(laborId.receivableId); }
        if (rentId) { generated.push({ type: 'CUSTOMER_CHARGE', code: rentId.businessId }); importedReceivableIds.push(rentId.receivableId); }
        summary.charges += Number(Boolean(laborId)) + Number(Boolean(rentId));
        if (receipt.deliveredQuantity > 0) {
            const releaseId = await generateNextId('STOCK_RELEASE');
            await client.query(`INSERT INTO batch_movements(batch_id,from_location_id,movement_type,quantity,reference_type,reference_id,created_by,created_at,notes) VALUES($1,$2,'DELIVERY',$3,'STOCK_RELEASE',$4,$5,$6,$7)`, [batch.id, location?.id || null, receipt.deliveredQuantity, releaseId, user.id, receipt.deliveryDate || receipt.receivedDate, receipt.gatePassReference ? `Legacy gate pass ${receipt.gatePassReference}` : null]);
            await recordStockMovement(client, { productId: product.id, warehouseId: warehouse.id, movementType: 'OUT', quantity: receipt.deliveredQuantity, referenceType: 'STOCK_RELEASE', referenceId: releaseId, createdBy: user.id, notes: receipt.gatePassReference ? `Legacy gate pass ${receipt.gatePassReference}` : null });
            await client.query(`INSERT INTO stock_release_documents(business_id,company_id,customer_id,batch_id,quantity,previous_quantity,remaining_quantity,rental_due_through,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [releaseId, user.company_id, customer.id, batch.id, receipt.deliveredQuantity, receipt.totalLots, receipt.remainingQuantity, receipt.deliveryDate, user.id, receipt.deliveryDate || receipt.receivedDate]);
            await posting(client, job.id, 'stock_release', receipt.externalReference, 'STOCK_RELEASE', releaseId, { gatePassReference: receipt.gatePassReference });
            generated.push({ type: 'STOCK_RELEASE', code: releaseId }); summary.deliveries++;
        }
        summary.goodsReceipts++; summary.units += Math.floor(receipt.totalLots);
    }
    for (const payment of data.payments || []) {
        const paymentBusinessId = await generateNextId('CUSTOMER_PAYMENT');
        const saved = (await client.query(`INSERT INTO customer_payments(business_id,company_id,customer_id,account_id,amount,payment_date,reference,notes,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$6::date) RETURNING *`, [paymentBusinessId, user.company_id, customer.id, account.id, payment.amount, payment.paymentDate, payment.reference, `Imported from ${job.original_name}`, user.id])).rows[0];
        let remaining = Number(payment.amount);
        const dues = (await client.query(`SELECT * FROM customer_receivables WHERE customer_id=$1 AND id=ANY($2::uuid[]) AND status IN('unpaid','partial') ORDER BY due_date,created_at FOR UPDATE`, [customer.id, importedReceivableIds])).rows;
        for (const due of dues) {
            if (remaining <= 0.0001) break;
            const allocation = Math.min(Number(due.original_amount) - Number(due.paid_amount), remaining);
            if (allocation <= 0) continue;
            await client.query(`INSERT INTO customer_payment_allocations(payment_id,receivable_id,amount) VALUES($1,$2,$3)`, [saved.id, due.id, allocation]);
            await client.query(`UPDATE customer_receivables SET paid_amount=paid_amount+$1,status=CASE WHEN paid_amount+$1>=original_amount THEN 'paid' ELSE 'partial' END WHERE id=$2`, [allocation, due.id]);
            remaining -= allocation;
        }
        if (remaining > 0.0001) throw Object.assign(new Error(`Payment ${payment.reference || payment.paymentDate} exceeds available customer charges by ${remaining}`), { statusCode: 409 });
        await recordAccountTransaction(client, { accountId: account.id, transactionType: 'DEPOSIT', amount: payment.amount, referenceType: 'CUSTOMER_PAYMENT', referenceId: paymentBusinessId, createdBy: user.id, notes: `Imported ${payment.reference || ''}` });
        const receiptBusinessId = await generateNextId('MONEY_RECEIPT');
        await client.query(`INSERT INTO financial_documents(business_id,company_id,document_type,account_id,customer_id,source_type,source_id,amount,description,created_by,created_at) VALUES($1,$2,'MONEY_RECEIPT',$3,$4,'CUSTOMER_PAYMENT',$5,$6,$7,$8,$9::date)`, [receiptBusinessId, user.company_id, account.id, customer.id, paymentBusinessId, payment.amount, `Imported receipt ${payment.reference || ''}`, user.id, payment.paymentDate]);
        await posting(client, job.id, 'customer_payment', payment.reference || payment.paymentDate, 'CUSTOMER_PAYMENT', paymentBusinessId, payment);
        generated.push({ type: 'CUSTOMER_PAYMENT', code: paymentBusinessId }, { type: 'MONEY_RECEIPT', code: receiptBusinessId }); summary.payments++;
    }
    return { imported: Object.values(summary).reduce((sum, count) => sum + Number(count), 0), generated, summary, customerBusinessId: customer.business_id };
}
async function submit(req, res) {
    const result = await withTransaction(async (client) => {
        const { rows } = await client.query(`SELECT * FROM bulk_import_jobs WHERE business_id=$1 AND company_id=$2 AND status='review' FOR UPDATE`, [req.params.businessId, req.user.company_id]);
        if (!rows.length) throw Object.assign(new Error('Review job not found'), { statusCode: 404 });
        const job = rows[0];
        if (job.extraction_result?.mode === 'multi_domain') throw Object.assign(new Error('This multi-department extraction is review-only for the demo. Save the review now; final posting remains locked until you confirm the detected results.'), { statusCode: 409 });
        const outcome = job.extraction_result?.mode === 'structured' ? await submitStructured(client, job, req.user) : await submitFlat(client, job, req.user);
        if (outcome.errors) { await client.query(`UPDATE bulk_import_jobs SET validation_errors=$1::jsonb WHERE id=$2`, [JSON.stringify(outcome.errors), job.id]); return outcome; }
        const compactResult = { summary: outcome.summary, customerBusinessId: outcome.customerBusinessId || null };
        await client.query(`UPDATE bulk_import_jobs SET status='submitted',file_path='',detected_columns='[]',preview_rows='[]',field_mapping='{}',submission_options='{}',validation_errors='[]',extraction_result=jsonb_build_object('mode','submitted','summary',$1::jsonb),routing_plan='[]',submission_result=$1::jsonb,submitted_by=$2,submitted_at=now() WHERE id=$3`, [JSON.stringify(compactResult), req.user.id, job.id]);
        await client.query(`UPDATE bulk_import_postings SET details='{}'::jsonb WHERE job_id=$1`, [job.id]);
        return outcome;
    });
    if (result.errors) return res.status(422).json({ error: 'Complete the review requirements before final submission', validationErrors: result.errors });
    for (const item of result.generated) await generateForEntitySafe(item.type, item.code);
    res.json({ imported: result.imported, summary: result.summary, customerBusinessId: result.customerBusinessId, message: 'Approved records were routed to their relevant departments' });
}
function template(req, res) {
    const headers = { customer: ['name', 'phone', 'email', 'address', 'customerType'], product: ['name', 'sku', 'category', 'unit', 'unitPrice', 'monthlyRentPerUnit'], vendor: ['name', 'phone', 'email', 'address', 'vendorType'] }[req.params.type];
    if (!headers) return res.status(404).json({ error: 'Template type not found' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-bulk-upload-template.csv"`); res.send('\uFEFF' + headers.join(',') + '\r\n');
}
async function remove(req, res) {
    const { rows } = await query(`DELETE FROM bulk_import_jobs WHERE business_id=$1 AND company_id=$2 AND status='review' RETURNING file_path`, [req.params.businessId, req.user.company_id]);
    if (!rows.length) return res.status(409).json({ error: 'Only a review-stage import can be removed' });
    deleteTemporaryUpload(rows[0].file_path);
    res.json({ message: 'Review import removed' });
}

module.exports = { upload, list, get, updateMapping: updateReview, submit, template, remove };
