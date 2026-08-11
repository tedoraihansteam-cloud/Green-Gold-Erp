const fs = require('fs');
const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { generateForEntitySafe } = require('../services/qrBarcodeService');
const { analyzeFile, recalculateStructuredReview, recalculateMultiDomainReview } = require('../services/universalImportService');
const { recordStockMovement } = require('./inventoryController');
const { recordAccountTransaction } = require('./accountController');
const { createReceivable } = require('../services/receivableService');
const { logAction } = require('../services/auditLogger');

function deleteTemporaryUpload(filePath) {
    if (!filePath) return;
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); }
    catch (error) { console.error(`Temporary import cleanup failed for ${filePath}:`, error.message); }
}
const normalizedAlias=(value)=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function applyEntityMatches(extraction,context,aliases=[]){if(extraction?.mode!=='multi_domain')return extraction;const masters=[...(context.customers||[]).map(x=>({...x,entityType:'CUSTOMER',matchName:x.name})),...(context.vendors||[]).map(x=>({...x,entityType:'VENDOR',matchName:x.name})),...(context.employees||[]).map(x=>({...x,entityType:'EMPLOYEE',matchName:x.full_name})),...(context.accounts||[]).map(x=>({...x,entityType:'ACCOUNT',matchName:x.name}))],roles={CUSTOMER:'customer',VENDOR:'vendor',EMPLOYEE:'staff',ACCOUNT:'account'};return{...extraction,entityCandidates:(extraction.entityCandidates||[]).map(entity=>{if(entity.matchSuppressed||entity.matchBusinessId)return entity;const key=normalizedAlias(entity.name),alias=aliases.find(x=>x.normalized_alias===key),exact=masters.find(x=>normalizedAlias(x.matchName)===key);const match=alias?{businessId:alias.target_business_id,entityType:alias.target_entity_type,status:'saved_alias'}:exact?{businessId:exact.business_id,entityType:exact.entityType,status:'exact_name'}:null;return match?{...entity,role:entity.role||roles[match.entityType],matchBusinessId:match.businessId,matchEntityType:match.entityType,matchStatus:match.status}:entity;})};}
async function persistAliasDecisions(extraction,user){const tables={CUSTOMER:'master_customers',VENDOR:'master_vendors',EMPLOYEE:'master_employees',ACCOUNT:'accounts'};for(const entity of extraction?.entityCandidates||[]){const key=normalizedAlias(entity.name);if(!key)continue;if(entity.matchSuppressed){await query(`DELETE FROM bulk_import_entity_aliases WHERE company_id=$1 AND normalized_alias=$2`,[user.company_id,key]);continue;}if(!entity.matchConfirmed||!entity.matchBusinessId||!tables[entity.matchEntityType])continue;const target=(await query(`SELECT business_id FROM ${tables[entity.matchEntityType]} WHERE company_id=$1 AND business_id=$2 AND deleted_at IS NULL`,[user.company_id,entity.matchBusinessId])).rows[0];if(!target)throw Object.assign(new Error(`The selected ${entity.matchEntityType.toLowerCase()} for ${entity.name} no longer exists`),{statusCode:422});await query(`INSERT INTO bulk_import_entity_aliases(company_id,normalized_alias,display_alias,target_entity_type,target_business_id,candidate_class,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(company_id,normalized_alias) DO UPDATE SET display_alias=EXCLUDED.display_alias,target_entity_type=EXCLUDED.target_entity_type,target_business_id=EXCLUDED.target_business_id,candidate_class=EXCLUDED.candidate_class,updated_at=now()`,[user.company_id,key,entity.name,entity.matchEntityType,entity.matchBusinessId,entity.candidateClass||null,user.id]);}}
async function registerGeneratedCodes(items = []) {
    const seen = new Set();
    for (const item of items) {
        if (!item?.type || !item?.code) continue;
        const key = `${item.type}:${item.code}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await generateForEntitySafe(item.type, item.code);
    }
}
function routedGeneratedEntities(routed = []) {
    const entities = [];
    for (const route of routed) {
        const result = route.result?.result || route.result || {};
        for (const item of result.generated || []) {
            if (item && typeof item === 'object') entities.push(item);
            else if (item && result.targetType) entities.push({ type: result.targetType, code: item });
        }
        if (result.targetType && result.targetId) entities.push({ type: result.targetType, code: result.targetId });
    }
    return entities;
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
        const [warehouses, locations, accounts, customers, vendors, employees, departments, sites, duplicateUploads, aliases] = await Promise.all([
            query(`SELECT business_id,name FROM warehouses WHERE company_id=$1 AND deleted_at IS NULL ORDER BY name`, [companyId]),
            query(`SELECT sl.business_id,sl.name,sl.location_type,w.business_id warehouse_business_id,w.name warehouse_name FROM storage_locations sl JOIN warehouses w ON w.id=sl.warehouse_id WHERE sl.company_id=$1 AND sl.deleted_at IS NULL ORDER BY w.name,sl.name`, [companyId]),
            query(`SELECT business_id,name,account_type,current_balance FROM accounts WHERE company_id=$1 AND deleted_at IS NULL AND status='active' ORDER BY account_type,name`, [companyId]),
            query(`SELECT business_id,name,phone FROM master_customers WHERE company_id=$1 AND deleted_at IS NULL ORDER BY name`, [companyId]),
            query(`SELECT business_id,name,phone FROM master_vendors WHERE company_id=$1 AND deleted_at IS NULL ORDER BY name`, [companyId]),
            query(`SELECT business_id,full_name,designation FROM master_employees WHERE company_id=$1 AND deleted_at IS NULL ORDER BY full_name`, [companyId]),
            query(`SELECT d.business_id,d.name,b.name branch_name FROM departments d JOIN branches b ON b.id=d.branch_id WHERE b.company_id=$1 AND d.status='active' ORDER BY b.name,d.name`, [companyId]),
            query(`SELECT id,name,site_type,address FROM company_sites WHERE company_id=$1 ORDER BY name`, [companyId]),
            job.source_summary?.sourceHash ? query(`SELECT business_id,original_name,status,created_at FROM bulk_import_jobs WHERE company_id=$1 AND id<>$2 AND source_summary->>'sourceHash'=$3 ORDER BY created_at DESC LIMIT 10`, [companyId, job.id, job.source_summary.sourceHash]) : Promise.resolve({ rows: [] }),
            query(`SELECT normalized_alias,target_entity_type,target_business_id,candidate_class FROM bulk_import_entity_aliases WHERE company_id=$1`,[companyId])
        ]);
        const [workflow, events] = await Promise.all([
            query(`SELECT enabled,display_name,approval_steps FROM workflow_definitions WHERE company_id=$1 AND workflow_key='universal_data_import'`, [companyId]),
            query(`SELECT e.step_index,e.step_name,e.action,e.notes,e.created_at,u.username,u.display_name FROM bulk_import_approval_events e JOIN users u ON u.id=e.actor_user_id WHERE e.job_id=$1 ORDER BY e.created_at`, [job.id])
        ]);
        const approvalSteps = (job.approval_snapshot?.length ? job.approval_snapshot : workflow.rows[0]?.approval_steps) || [];
        const matchContext={accounts:accounts.rows,customers:customers.rows,vendors:vendors.rows,employees:employees.rows};
        return { ...job, extraction_result:applyEntityMatches(job.extraction_result,matchContext,aliases.rows), review_context: {
            warehouses: warehouses.rows, locations: locations.rows, accounts: accounts.rows,
            customers: customers.rows, vendors: vendors.rows, employees: employees.rows,
            departments: departments.rows, sites: sites.rows, duplicateUploads: duplicateUploads.rows,
            workflow: { enabled: workflow.rows[0]?.enabled !== false, displayName: workflow.rows[0]?.display_name || 'Universal data import', steps: approvalSteps, currentStepIndex: job.approval_step_index || 0, currentStep: approvalSteps[job.approval_step_index || 0] || null, events: events.rows },
            postingLocked: false,
            postingMessage: 'Selected data will be routed only after every configured approval layer signs it.'
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
        await generateForEntitySafe('BULK_IMPORT', businessId);
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
    const current = (await query(`SELECT * FROM bulk_import_jobs WHERE business_id=$1 AND company_id=$2 AND status IN('review','partially_posted','posting_failed')`, [req.params.businessId, req.user.company_id])).rows[0];
    if (!current) return res.status(404).json({ error: 'Review job not found' });
    let revised = null;
    if (req.body.extractionResult && current.extraction_result?.mode === 'structured') revised = recalculateStructuredReview(req.body.extractionResult);
    if (req.body.extractionResult && current.extraction_result?.mode === 'multi_domain') {
        let requested = req.body.extractionResult;
        const originalSections = new Map((current.extraction_result.sections || []).map((section) => [section.id, section]));
        requested = { ...requested, sections: (requested.sections || []).map((section) => ({ ...section, sourceSnapshot: section.sourceSnapshot || originalSections.get(section.id)?.sourceSnapshot || originalSections.get(section.id)?.records || [] })) };
        if (current.final_approved_at) {
            const requestedSections = new Map((requested.sections || []).map((section) => [section.id, section]));
            requested = {
                ...current.extraction_result,
                sections: (current.extraction_result.sections || []).map((section) => ({
                    ...section,
                    postingOptions: requestedSections.get(section.id)?.postingOptions || section.postingOptions || {}
                }))
            };
        }
        revised = recalculateMultiDomainReview(requested);
    }
    const editableStatuses = current.final_approved_at ? ['partially_posted', 'posting_failed'] : ['review'];
    const { rows } = await query(`UPDATE bulk_import_jobs SET field_mapping=COALESCE($1,field_mapping),submission_options=COALESCE($2,submission_options),extraction_result=COALESCE($3::jsonb,extraction_result),source_summary=COALESCE($4::jsonb,source_summary),routing_plan=COALESCE($5::jsonb,routing_plan),validation_errors=COALESCE($6::jsonb,validation_errors) WHERE id=$7 AND status=ANY($8::text[]) RETURNING *`, [req.body.fieldMapping || null, req.body.submissionOptions || null, revised ? JSON.stringify(revised.extractionResult) : null, revised ? JSON.stringify(revised.sourceSummary) : null, revised ? JSON.stringify(revised.routingPlan) : null, revised ? JSON.stringify(revised.validationErrors) : null, current.id, editableStatuses]);
    if (!rows.length) return res.status(404).json({ error: 'Review job not found' });
    if(revised?.extractionResult?.mode==='multi_domain')await persistAliasDecisions(revised.extractionResult,req.user);
    if (revised?.extractionResult?.mode === 'multi_domain') await logAction({ actorUserId: req.user.id, action: 'BULK_IMPORT_MANUAL_REVIEW_SAVED', entityType: 'BULK_IMPORT', entityId: req.params.businessId, after: { manualSections: revised.extractionResult.sections.filter((section) => section.manualMode).map((section) => ({ id: section.id, mismatches: section.manualReview?.mismatches?.length || 0, manualRows: section.manualReview?.manualRows || 0, overrideConfirmed: !!section.manualOverride?.confirmed, overrideReason: section.manualOverride?.reason || null })), manualEntities: revised.extractionResult.entityCandidates.filter((entity) => entity.manualEntry).map((entity) => ({ name: entity.name, role: entity.role, matchBusinessId: entity.matchBusinessId || null })) } });
    res.json({ job: await reviewContext(rows[0], req.user.company_id) });
}
async function submitForApproval(req, res) {
    const result = await withTransaction(async (client) => {
        const job = (await client.query(`SELECT * FROM bulk_import_jobs WHERE business_id=$1 AND company_id=$2 AND status='review' FOR UPDATE`, [req.params.businessId, req.user.company_id])).rows[0];
        if (!job || job.extraction_result?.mode !== 'multi_domain') throw Object.assign(new Error('A multi-department review job is required'), { statusCode: 409 });
        const revised = recalculateMultiDomainReview(job.extraction_result);
        const blocking = revised.validationErrors.filter((error) => error.severity !== 'warning');
        if (blocking.length) {
            await client.query(`UPDATE bulk_import_jobs SET validation_errors=$1::jsonb WHERE id=$2`, [JSON.stringify(revised.validationErrors), job.id]);
            return { validationErrors: revised.validationErrors };
        }
        if (!revised.sourceSummary.selectedSections) throw Object.assign(new Error('Select at least one section before submitting'), { statusCode: 400 });
        const workflow = (await client.query(`SELECT * FROM workflow_definitions WHERE company_id=$1 AND workflow_key='universal_data_import'`, [req.user.company_id])).rows[0];
        if (!workflow?.enabled) throw Object.assign(new Error('Universal data import approval workflow is not enabled'), { statusCode: 409 });
        const steps = (workflow.approval_steps || []).filter((step) => step.required !== false);
        if (!steps.length) throw Object.assign(new Error('Configure at least one required approval layer in Workflow & individual duties'), { statusCode: 409 });
        const updated = (await client.query(`UPDATE bulk_import_jobs SET status='pending_approval',approval_step_index=0,approval_snapshot=$1::jsonb,submitted_for_approval_by=$2,submitted_for_approval_at=now(),approval_notes=NULL,validation_errors=$3::jsonb,extraction_result=$4::jsonb,source_summary=$5::jsonb,routing_plan=$6::jsonb WHERE id=$7 RETURNING *`, [JSON.stringify(steps), req.user.id, JSON.stringify(revised.validationErrors), JSON.stringify(revised.extractionResult), JSON.stringify(revised.sourceSummary), JSON.stringify(revised.routingPlan), job.id])).rows[0];
        await client.query(`INSERT INTO bulk_import_approval_events(job_id,step_index,step_name,action,notes,actor_user_id) VALUES($1,0,$2,'submitted',$3,$4)`, [job.id, steps[0].name, req.body.notes || null, req.user.id]);
        return { job: updated, nextStep: steps[0] };
    });
    if (result.validationErrors) return res.status(422).json({ error: 'Complete required routing questions before approval submission', validationErrors: result.validationErrors });
    await logAction({ actorUserId: req.user.id, action: 'BULK_IMPORT_APPROVAL_SUBMITTED', entityType: 'BULK_IMPORT', entityId: req.params.businessId });
    res.json({ job: await reviewContext(result.job, req.user.company_id), nextStep: result.nextStep, message: `Submitted to ${result.nextStep.name}` });
}
function sectionDepartment(type) {
    if (type.includes('payroll')) return 'HR';
    if (type === 'account_transactions') return 'ACCOUNTS';
    if (type.includes('receiving')) return 'INVENTORY';
    if (type.includes('customer')) return 'CUSTOMER MANAGEMENT';
    return 'MANAGEMENT';
}
const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const questionAnswer = (section, key) => (section.questions || []).find((item) => item.key === key)?.value || '';
async function resolveSelected(client, table, businessId, companyId, extra = '') {
    if (businessId) return (await client.query(`SELECT * FROM ${table} WHERE business_id=$1 AND company_id=$2 ${extra} LIMIT 1`, [businessId, companyId])).rows[0] || null;
    const rows = (await client.query(`SELECT * FROM ${table} WHERE company_id=$1 ${extra} ORDER BY created_at LIMIT 2`, [companyId])).rows;
    return rows.length === 1 ? rows[0] : null;
}
async function ensureEmployee(client, user, record, options = {}) {
    const selected=options.employeeBusinessId?(await client.query(`SELECT * FROM master_employees WHERE business_id=$1 AND company_id=$2 AND deleted_at IS NULL`,[options.employeeBusinessId,user.company_id])).rows[0]:null;
    const matched = selected||(await client.query(`SELECT * FROM master_employees WHERE company_id=$1 AND deleted_at IS NULL AND lower(full_name)=lower($2) ORDER BY CASE WHEN lower(COALESCE(designation,''))=lower($3) THEN 0 ELSE 1 END LIMIT 1`, [user.company_id, record.employeeName, record.designation || ''])).rows[0];
    if (matched) return { row: matched, created: false };
    let departmentId = null;
    if (options.departmentBusinessId) departmentId = (await client.query(`SELECT d.id FROM departments d JOIN branches b ON b.id=d.branch_id WHERE d.business_id=$1 AND b.company_id=$2`, [options.departmentBusinessId, user.company_id])).rows[0]?.id || null;
    const businessId = await generateNextId('EMPLOYEE');
    const row = (await client.query(`INSERT INTO master_employees(business_id,company_id,department_id,full_name,designation,status) VALUES($1,$2,$3,$4,$5,'active') RETURNING *`, [businessId, user.company_id, departmentId, record.employeeName, record.designation || null])).rows[0];
    return { row, created: true };
}
function candidateMatch(job,name,type){const key=normalizedAlias(name);return(job.extraction_result?.entityCandidates||[]).find(x=>normalizedAlias(x.name)===key&&x.selected!==false&&x.matchBusinessId&&(!type||x.matchEntityType===type))?.matchBusinessId||null;}
async function ensureCustomer(client, user, name, selectedBusinessId) {
    let row = selectedBusinessId ? (await client.query(`SELECT * FROM master_customers WHERE business_id=$1 AND company_id=$2 AND deleted_at IS NULL`, [selectedBusinessId, user.company_id])).rows[0] : null;
    if (!row && name) row = (await client.query(`SELECT * FROM master_customers WHERE company_id=$1 AND deleted_at IS NULL AND lower(name)=lower($2) LIMIT 1`, [user.company_id, name])).rows[0];
    if (row) return { row, created: false };
    const businessId = await generateNextId('CUSTOMER');
    row = (await client.query(`INSERT INTO master_customers(business_id,company_id,name,customer_type) VALUES($1,$2,$3,'imported_business_party') RETURNING *`, [businessId, user.company_id, name || 'Imported customer'])).rows[0];
    return { row, created: true };
}
async function ensureVendor(client, user, name, selectedBusinessId) {
    let row = selectedBusinessId ? (await client.query(`SELECT * FROM master_vendors WHERE business_id=$1 AND company_id=$2 AND deleted_at IS NULL`, [selectedBusinessId, user.company_id])).rows[0] : null;
    if (!row && name) row = (await client.query(`SELECT * FROM master_vendors WHERE company_id=$1 AND deleted_at IS NULL AND lower(name)=lower($2) LIMIT 1`, [user.company_id, name])).rows[0];
    if (row) return { row, created: false };
    const businessId = await generateNextId('VENDOR');
    row = (await client.query(`INSERT INTO master_vendors(business_id,company_id,name,vendor_type) VALUES($1,$2,$3,'imported_service_provider') RETURNING *`, [businessId, user.company_id, name || 'Imported vendor'])).rows[0];
    return { row, created: true };
}
async function ensureProduct(client, user, name, unit = 'pcs', category = 'Imported inventory') {
    let row = (await client.query(`SELECT * FROM products WHERE company_id=$1 AND deleted_at IS NULL AND lower(name)=lower($2) LIMIT 1`, [user.company_id, name])).rows[0];
    if (row) return { row, created: false };
    const businessId = await generateNextId('PRODUCT');
    row = (await client.query(`INSERT INTO products(business_id,company_id,name,category,unit) VALUES($1,$2,$3,$4,$5) RETURNING *`, [businessId, user.company_id, name, category, unit || 'pcs'])).rows[0];
    return { row, created: true };
}
function payrollPeriod(section) {
    const match = String(section.periodKey || '').match(/^(20\d{2})-(\d{2})$/);
    if (!match) throw Object.assign(new Error(`${section.title}: payroll year and month could not be detected`), { statusCode: 422 });
    return { year: Number(match[1]), month: Number(match[2]), effectiveDate: `${match[1]}-${match[2]}-01` };
}
async function postPayrollSection(client, job, section, user) {
    const period = payrollPeriod(section), options = section.postingOptions || {}, target = questionAnswer(section, 'postingTarget') || 'draft_payroll_run';
    if (target === 'reference_only') return { targetType: 'BULK_IMPORT_REFERENCE', targetId: section.id, records: section.records?.length || 0, generated: [], referenceOnly: true };
    if (target === 'attendance_only') throw Object.assign(new Error(`${section.title}: attendance posting is unavailable because the sheet has no clock-in or clock-out data`), { statusCode: 422 });
    const historyOnly = target === 'employee_salary_history';
    let run = historyOnly ? null : (await client.query(`SELECT * FROM payroll_runs WHERE company_id=$1 AND period_year=$2 AND period_month=$3 FOR UPDATE`, [user.company_id, period.year, period.month])).rows[0];
    if (run && !['draft', 'submitted_to_accounts'].includes(run.status)) throw Object.assign(new Error(`${section.title}: payroll ${section.periodKey} is already ${run.status}`), { statusCode: 409 });
    if (!historyOnly && !run) { const businessId = await generateNextId('PAYROLL_RUN'); run = (await client.query(`INSERT INTO payroll_runs(business_id,company_id,period_year,period_month,status,created_by) VALUES($1,$2,$3,$4,'draft',$5) RETURNING *`, [businessId, user.company_id, period.year, period.month, user.id])).rows[0]; }
    let createdEmployees = 0, postedItems = 0;
    for (const record of section.records || []) {
        const employee = await ensureEmployee(client, user, record, {...options,employeeBusinessId:candidateMatch(job,record.employeeName,'EMPLOYEE')}); if (employee.created) createdEmployees++;
        const basic = numeric(record.basicSalary), house = numeric(record.houseRent), medical = numeric(record.medicalAllowance), transport = numeric(record.conveyanceAllowance);
        const special = numeric(record.firstIncrement) + numeric(record.secondIncrement) + numeric(record.da) + numeric(record.utilityAllowance) + numeric(record.otherAllowance);
        const gross = numeric(record.grossSalary) || basic + house + medical + transport + special;
        const advance = numeric(record.advance), other = numeric(record.otherDeduction) + numeric(record.absenceDeduction), totalDeduction = numeric(record.totalDeduction) || advance + other;
        const net = numeric(record.netPayable) || Math.max(0, gross - totalDeduction);
        if (run) await client.query(`INSERT INTO payroll_items(payroll_run_id,employee_id,basic,house_rent,medical,transport,special_allowance,advance_deduction,other_deduction,gross_pay,total_deductions,net_pay) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(payroll_run_id,employee_id) DO UPDATE SET basic=EXCLUDED.basic,house_rent=EXCLUDED.house_rent,medical=EXCLUDED.medical,transport=EXCLUDED.transport,special_allowance=EXCLUDED.special_allowance,advance_deduction=EXCLUDED.advance_deduction,other_deduction=EXCLUDED.other_deduction,gross_pay=EXCLUDED.gross_pay,total_deductions=EXCLUDED.total_deductions,net_pay=EXCLUDED.net_pay`, [run.id, employee.row.id, basic, house, medical, transport, special, advance, other, gross, totalDeduction, net]);
        const salaryExists = (await client.query(`SELECT 1 FROM employee_salary_history WHERE employee_id=$1 AND effective_date=$2::date LIMIT 1`, [employee.row.id, period.effectiveDate])).rows.length;
        if (!salaryExists) await client.query(`INSERT INTO employee_salary_history(company_id,employee_id,basic,house_rent,medical,transport,special_allowance,effective_date,set_by,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [user.company_id, employee.row.id, basic, house, medical, transport, special, period.effectiveDate, user.id, `Imported from ${job.business_id} / ${section.sheetName}`]);
        postedItems++;
    }
    const employeeCodes = [];
    for (const record of section.records || []) {
        const employee = (await client.query(`SELECT business_id FROM master_employees WHERE company_id=$1 AND deleted_at IS NULL AND lower(full_name)=lower($2) LIMIT 1`, [user.company_id, record.employeeName])).rows[0];
        if (employee) employeeCodes.push({ type: 'EMPLOYEE', code: employee.business_id });
    }
    return run ? { targetType: 'PAYROLL_RUN', targetId: run.business_id, records: postedItems, createdEmployees, generated: [{ type: 'PAYROLL_RUN', code: run.business_id }, ...employeeCodes] } : { targetType: 'EMPLOYEE_SALARY_HISTORY', targetId: section.periodKey, records: postedItems, createdEmployees, generated: employeeCodes };
}
async function postSecuritySection(client, job, section, user) {
    const options = section.postingOptions || {}, target = questionAnswer(section, 'postingTarget') || 'vendor_bill', vendorChoice = questionAnswer(section, 'vendorMatch') || 'create_new_vendor';
    if (target === 'reference_only') return { targetType: 'BULK_IMPORT_REFERENCE', targetId: section.id, records: section.records?.length || 0, generated: [], referenceOnly: true };
    if (target !== 'vendor_bill') throw Object.assign(new Error(`${section.title}: attendance cannot be created from a payroll-only sheet`), { statusCode: 422 });
    const vendorName = String(section.sheetName || section.title).replace(/payroll|salary|sheet|\d{4}|[-_/]/gi, ' ').replace(/\s+/g, ' ').trim() || 'Security service provider';
    if (vendorChoice === 'ask_user_to_select_existing_vendor' && !options.vendorBusinessId) throw Object.assign(new Error(`${section.title}: select the existing security-service vendor`), { statusCode: 422 });
    const vendor = vendorChoice === 'do_not_create_vendor' && !options.vendorBusinessId ? { row: { id: null, name: vendorName }, created: false } : await ensureVendor(client, user, vendorName, options.vendorBusinessId);
    const amount = numeric(section.summary?.netPayable) || (section.records || []).reduce((sum, row) => sum + numeric(row.netPayable), 0);
    if (amount <= 0) throw Object.assign(new Error(`${section.title}: no payable amount was detected`), { statusCode: 422 });
    const existing = (await client.query(`SELECT business_id FROM bill_submissions WHERE company_id=$1 AND related_type='BULK_IMPORT_SECTION' AND related_id=$2 LIMIT 1`, [user.company_id, section.id])).rows[0];
    if (existing) return { targetType: 'BILL_SUBMISSION', targetId: existing.business_id, records: section.records?.length || 0, generated: [existing.business_id], matchedExisting: true };
    const businessId = await generateNextId('BILL_SUBMISSION');
    await client.query(`INSERT INTO bill_submissions(business_id,company_id,submitter_user_id,vendor_id,bill_number,bill_date,category,payee,amount,description,related_type,related_id,status,submitted_at,claimant_type,expense_breakdown) VALUES($1,$2,$3,$4,$5,CURRENT_DATE,'OUTSOURCED_SECURITY',$6,$7,$8,'BULK_IMPORT_SECTION',$9,'submitted',now(),'vendor',$10::jsonb)`, [businessId, user.company_id, user.id, vendor.row.id, `${job.business_id}-${section.periodKey || section.sheetName}`, vendor.row.name, amount, `Imported outsourced security payroll from ${section.sheetName}`, section.id, JSON.stringify(section.records || [])]);
    return { targetType: 'BILL_SUBMISSION', targetId: businessId, records: section.records?.length || 0, createdVendor: vendor.created, generated: [{ type: 'BILL_SUBMISSION', code: businessId }, ...(vendor.created ? [{ type: 'VENDOR', code: vendor.row.business_id }] : [])] };
}
async function postAccountSection(client, job, section, user) {
    const options = section.postingOptions || {}, target = questionAnswer(section, 'postingTarget') || 'draft_for_accounts_review', accountMatch = questionAnswer(section, 'accountMatch') || 'ask_user_to_select_account';
    if (target === 'reference_only' || target === 'skip_section' || accountMatch === 'reference_only') return { targetType: 'BULK_IMPORT_REFERENCE', targetId: section.id, records: section.records?.length || 0, generated: [], referenceOnly: true };
    const sourceMatches=(job.extraction_result?.entityCandidates||[]).filter(x=>x.selected!==false&&x.matchEntityType==='ACCOUNT'&&x.matchBusinessId&&(x.sources||[]).includes(section.sheetName));
    const account = await resolveSelected(client, 'accounts', options.accountBusinessId||(sourceMatches.length===1?sourceMatches[0].matchBusinessId:null), user.company_id, `AND deleted_at IS NULL AND status='active'`);
    if (!account) throw Object.assign(new Error(`${section.title}: select the ERP cash/bank account before posting`), { statusCode: 422 });
    let posted = 0;
    for (const record of section.records || []) {
        const legs = options.debitMeaning === 'deposit' ? [{ amount: record.debit, type: 'DEPOSIT' }, { amount: record.credit, type: 'WITHDRAWAL' }] : [{ amount: record.debit, type: 'WITHDRAWAL' }, { amount: record.credit, type: 'DEPOSIT' }];
        for (const leg of legs.filter((item) => numeric(item.amount) > 0)) {
            const referenceId = `${job.business_id}:${section.id}:${record.sourceRow}:${leg.type}`;
            if ((await client.query(`SELECT 1 FROM account_transactions WHERE account_id=$1 AND reference_type='BULK_IMPORT' AND reference_id=$2`, [account.id, referenceId])).rows.length) continue;
            await recordAccountTransaction(client, { accountId: account.id, transactionType: leg.type, amount: numeric(leg.amount), referenceType: 'BULK_IMPORT', referenceId, createdBy: user.id, notes: `${record.date} · ${record.party || record.ledgerHead || ''} · ${record.particular || record.purpose || ''} · voucher ${record.voucherNumber || '-'}` });
            posted++;
        }
    }
    return { targetType: 'ACCOUNT', targetId: account.business_id, records: posted, generated: [account.business_id] };
}
async function postRawReceivingSection(client, job, section, user) {
    const options = section.postingOptions || {}, ownerRole = questionAnswer(section, 'ownerRole') || 'company_owned_inventory', ownerMatch = questionAnswer(section, 'ownerMatch') || 'reference_only', warehouseChoice = questionAnswer(section, 'warehouse') || 'ask_user_to_select_warehouse_and_location';
    if (warehouseChoice === 'reference_only' || ownerMatch === 'reference_only' && ownerRole !== 'company_owned_inventory') return { targetType: 'BULK_IMPORT_REFERENCE', targetId: section.id, records: section.records?.length || 0, generated: [], referenceOnly: true };
    if (ownerRole === 'vendor_consignment' || ownerRole === 'ask_for_each_product') throw Object.assign(new Error(`${section.title}: choose company-owned inventory or customer-owned storage before posting`), { statusCode: 422 });
    let location = options.locationBusinessId ? (await client.query(`SELECT * FROM storage_locations WHERE business_id=$1 AND company_id=$2 AND deleted_at IS NULL`, [options.locationBusinessId, user.company_id])).rows[0] : null;
    let warehouse = location ? (await client.query(`SELECT * FROM warehouses WHERE id=$1`, [location.warehouse_id])).rows[0] : await resolveSelected(client, 'warehouses', options.warehouseBusinessId, user.company_id, `AND deleted_at IS NULL`);
    if (!warehouse) throw Object.assign(new Error(`${section.title}: select the receiving warehouse before posting`), { statusCode: 422 });
    if (ownerRole === 'customer_owned_storage' && ownerMatch === 'ask_user_to_select_entity' && !options.customerBusinessId) throw Object.assign(new Error(`${section.title}: select the customer who owns the received goods`), { statusCode: 422 });
    const ownerName = section.summary?.customer || null; const owner = ownerRole === 'customer_owned_storage' ? await ensureCustomer(client, user, ownerName || 'Imported stock owner', options.customerBusinessId) : null;
    let posted = 0; const generated = [];
    for (const record of section.records || []) {
        const external = `${job.business_id}:${section.id}:${record.sourceRow}`;
        const existing = (await client.query(`SELECT business_id FROM product_batches WHERE company_id=$1 AND source_reference=$2 LIMIT 1`, [user.company_id, external])).rows[0];
        if (existing) { generated.push({ type: 'PRODUCT_BATCH', code: existing.business_id }); continue; }
        const product = await ensureProduct(client, user, record.productName, record.unit || 'pcs', 'Imported receiving');
        const batchBusinessId = await generateNextId('PRODUCT_BATCH'), quantity = numeric(record.quantity || record.totalLots);
        const batch = (await client.query(`INSERT INTO product_batches(business_id,company_id,product_id,owner_customer_id,lot_number,source_reference,received_quantity,available_quantity,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7,'available',$8) RETURNING *`, [batchBusinessId, user.company_id, product.row.id, owner?.row.id || null, record.externalReference || null, external, quantity, user.id])).rows[0];
        await recordStockMovement(client, { productId: product.row.id, warehouseId: warehouse.id, movementType: 'IN', quantity, referenceType: 'BULK_IMPORT', referenceId: batchBusinessId, createdBy: user.id, notes: `${record.totalKg || 0} kg; source ${section.sheetName}` });
        if (location) await client.query(`INSERT INTO batch_location_balances(batch_id,location_id,quantity) VALUES($1,$2,$3) ON CONFLICT(batch_id,location_id) DO UPDATE SET quantity=batch_location_balances.quantity+EXCLUDED.quantity`, [batch.id, location.id, quantity]);
        const grnBusinessId = await generateNextId('GOODS_RECEIPT');
        await client.query(`INSERT INTO goods_receipts(business_id,company_id,batch_id,customer_id,warehouse_id,received_quantity,condition_notes,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::date,CURRENT_DATE))`, [grnBusinessId, user.company_id, batch.id, owner?.row.id || null, warehouse.id, quantity, `Imported ${record.totalKg || 0} kg; vehicle ${record.vehicleNumber || '-'}`, user.id, record.receivedDate || null]);
        generated.push({ type: 'PRODUCT_BATCH', code: batchBusinessId }, { type: 'GOODS_RECEIPT', code: grnBusinessId });
        if (product.created) generated.push({ type: 'PRODUCT', code: product.row.business_id });
        if (owner?.created) generated.push({ type: 'CUSTOMER', code: owner.row.business_id });
        posted++;
    }
    return { targetType: 'WAREHOUSE', targetId: warehouse.business_id, records: posted, generated };
}
async function postBalanceSummarySection(client, job, section, user) {
    const target = questionAnswer(section, 'postingTarget') || 'create_customer_opening_balances';
    if (target === 'reconciliation_only' || target === 'skip_section') return { targetType: 'BULK_IMPORT_REFERENCE', targetId: section.id, records: section.records?.length || 0, generated: [], referenceOnly: true };
    let posted = 0, createdCustomers = 0; const generated = [];
    for (const record of section.records || []) {
        const customer = await ensureCustomer(client, user, record.partyName, candidateMatch(job,record.partyName,'CUSTOMER')); if (customer.created) createdCustomers++;
        const due = Math.max(0, numeric(record.total)); if (due <= 0) continue;
        const sourceId = `${job.business_id}:${section.id}:${record.sourceRow}`;
        if ((await client.query(`SELECT 1 FROM customer_receivables WHERE source_type='BULK_IMPORT_OPENING' AND source_id=$1`, [sourceId])).rows.length) continue;
        const receivable = await createReceivable(client, { companyId: user.company_id, customerId: customer.row.id, sourceType: 'BULK_IMPORT_OPENING', sourceId, description: `Imported opening due from ${section.sheetName}`, amount: due, dueDate: new Date().toISOString().slice(0, 10) });
        if (customer.created) generated.push({ type: 'CUSTOMER', code: customer.row.business_id });
        posted++;
    }
    return { targetType: 'CUSTOMER_RECEIVABLE', targetId: null, records: posted, createdCustomers, generated };
}
async function postCustomerLedgerSection(client, job, section, user) {
    const options = section.postingOptions || {}, data = JSON.parse(JSON.stringify(section.data || {})), warehouseChoice = questionAnswer(section, 'warehouse'), customerChoice = questionAnswer(section, 'customerMatch'), entityRole = questionAnswer(section, 'entityRole');
    if (warehouseChoice === 'reference_only' || customerChoice === 'skip_entity' || entityRole === 'other') return { targetType: 'BULK_IMPORT_REFERENCE', targetId: section.id, records: section.records?.length || 0, generated: [], referenceOnly: true };
    if (customerChoice === 'ask_user_to_select_existing_customer' && !options.customerBusinessId) throw Object.assign(new Error(`${section.title}: select the existing customer before posting`), { statusCode: 422 });
    if (!data.customer || !Array.isArray(data.goodsReceipts)) throw Object.assign(new Error(`${section.title}: structured customer ledger data is unavailable`), { statusCode: 422 });
    for (const receipt of data.goodsReceipts) receipt.externalReference = `${section.id}:${receipt.externalReference}`;
    for (const delivery of data.deliveries || []) { delivery.externalReference = `${section.id}:${delivery.externalReference}`; delivery.batchExternalReference = `${section.id}:${delivery.batchExternalReference}`; }
    const warehouse = await resolveSelected(client, 'warehouses', options.warehouseBusinessId, user.company_id, `AND deleted_at IS NULL`);
    const account = (data.payments || []).length ? await resolveSelected(client, 'accounts', options.accountBusinessId, user.company_id, `AND deleted_at IS NULL AND status='active'`) : null;
    const pseudoJob = { ...job, extraction_result: data, validation_errors: [], submission_options: { customerBusinessId: options.customerBusinessId || '', warehouseBusinessId: warehouse?.business_id || '', locationBusinessId: options.locationBusinessId || '', accountBusinessId: account?.business_id || '', confirmAdjustments: true } };
    const outcome = await submitStructured(client, pseudoJob, user); if (outcome.errors) throw Object.assign(new Error(outcome.errors.map((item) => item.message).join('; ')), { statusCode: 422 });
    return { targetType: 'CUSTOMER', targetId: outcome.customerBusinessId, records: outcome.imported, generated: outcome.generated || [], summary: outcome.summary };
}
async function postMultiDomainSection(client, job, section, user) {
    if (section.type === 'manual_data_entry') return { targetType: 'BULK_IMPORT_REFERENCE', targetId: section.id, records: section.records?.length || 0, generated: [], referenceOnly: true };
    if (section.type === 'employee_payroll') return postPayrollSection(client, job, section, user);
    if (section.type === 'outsourced_security_payroll') return postSecuritySection(client, job, section, user);
    if (section.type === 'account_transactions') return postAccountSection(client, job, section, user);
    if (section.type === 'raw_material_receiving') return postRawReceivingSection(client, job, section, user);
    if (section.type === 'customer_balance_summary') return postBalanceSummarySection(client, job, section, user);
    if (section.type === 'customer_stock_rental_ledger') return postCustomerLedgerSection(client, job, section, user);
    throw Object.assign(new Error(`No operational posting adapter exists for ${section.type}`), { statusCode: 422 });
}
async function postManualEntities(client, job, user) {
    const generated = [];
    for (const entity of (job.extraction_result?.entityCandidates || []).filter((item) => item.selected && item.manualEntry && !['ignore', 'other', 'external_person'].includes(item.role))) {
        if (entity.role === 'customer' || entity.role === 'both') { const result = await ensureCustomer(client, user, entity.name, entity.matchBusinessId); if (result.created) generated.push({ type: 'CUSTOMER', code: result.row.business_id }); }
        if (entity.role === 'vendor' || entity.role === 'both') { const result = await ensureVendor(client, user, entity.name, entity.matchBusinessId); if (result.created) generated.push({ type: 'VENDOR', code: result.row.business_id }); }
        if (entity.role === 'staff') { const result = await ensureEmployee(client, user, { employeeName: entity.name, designation: entity.designation || '' }, { departmentBusinessId: entity.departmentBusinessId,employeeBusinessId:entity.matchBusinessId }); if (result.created) generated.push({ type: 'EMPLOYEE', code: result.row.business_id }); }
    }
    return generated;
}
async function routeApprovedMultiDomain(client, job, user) {
    const sections = (job.extraction_result?.sections || []).filter((section) => section.selected);
    const manualEntities = await postManualEntities(client, job, user);
    const routed = manualEntities.length ? [{ sectionId: 'manual-entities', department: 'MASTER DATA', status: 'posted', records: manualEntities.length, result: { title: 'Manually defined entities', targetType: 'MASTER_DATA', generated: manualEntities } }] : [];
    for (let index = 0; index < sections.length; index++) {
        const section = sections[index], savepoint = `import_section_${index}`;
        const department = sectionDepartment(section.type);
        const already = (await client.query(`SELECT * FROM bulk_import_postings WHERE job_id=$1 AND record_type=$2 AND external_key=$3 AND status='posted'`, [job.id, section.type, section.fingerprint])).rows[0];
        if (already) { routed.push({ sectionId: section.id, department, status: 'posted', records: numeric(already.details?.records), result: already.details, skippedExisting: true }); continue; }
        await client.query(`SAVEPOINT ${savepoint}`);
        try {
            const result = await postMultiDomainSection(client, job, section, user);
            const details = { sectionId: section.id, title: section.title, sourceSheet: section.sheetName, department, records: result.records || 0, generated: result.generated || [], result, postedAt: new Date().toISOString() };
            await client.query(`INSERT INTO bulk_import_postings(job_id,record_type,external_key,target_entity_type,target_entity_id,status,details) VALUES($1,$2,$3,$4,$5,'posted',$6::jsonb) ON CONFLICT(job_id,record_type,external_key) DO UPDATE SET target_entity_type=EXCLUDED.target_entity_type,target_entity_id=EXCLUDED.target_entity_id,status='posted',details=EXCLUDED.details`, [job.id, section.type, section.fingerprint, result.targetType || null, result.targetId || null, JSON.stringify(details)]);
            await client.query(`RELEASE SAVEPOINT ${savepoint}`);
            routed.push({ sectionId: section.id, department, status: 'posted', records: result.records || 0, result: details });
        } catch (error) {
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`); await client.query(`RELEASE SAVEPOINT ${savepoint}`);
            const details = { sectionId: section.id, title: section.title, sourceSheet: section.sheetName, department, records: 0, error: error.message, failedAt: new Date().toISOString() };
            await client.query(`INSERT INTO bulk_import_postings(job_id,record_type,external_key,status,details) VALUES($1,$2,$3,'failed',$4::jsonb) ON CONFLICT(job_id,record_type,external_key) DO UPDATE SET status='failed',details=EXCLUDED.details`, [job.id, section.type, section.fingerprint, JSON.stringify(details)]);
            routed.push({ sectionId: section.id, department, status: 'failed', records: 0, error: error.message });
        }
    }
    return routed;
}
async function decideApproval(req, res) {
    const { decision, notes } = req.body;
    if (!['approve', 'reject', 'return'].includes(decision) || !String(notes || '').trim()) return res.status(400).json({ error: 'Decision and remarks are required' });
    const result = await withTransaction(async (client) => {
        const job = (await client.query(`SELECT * FROM bulk_import_jobs WHERE business_id=$1 AND company_id=$2 AND status='pending_approval' FOR UPDATE`, [req.params.businessId, req.user.company_id])).rows[0];
        if (!job) throw Object.assign(new Error('Pending approval import was not found'), { statusCode: 409 });
        const steps = job.approval_snapshot || [], index = Number(job.approval_step_index || 0), step = steps[index];
        if (!step) throw Object.assign(new Error('The current approval layer is not configured'), { statusCode: 409 });
        if (!req.permissions.has(step.permission)) throw Object.assign(new Error(`This layer requires ${step.permission}`), { statusCode: 403 });
        if (step.assigneeUserId && step.assigneeUserId !== req.user.id) throw Object.assign(new Error(`This layer is assigned to another authorized person`), { statusCode: 403 });
        if (decision === 'reject') {
            const updated = (await client.query(`UPDATE bulk_import_jobs SET status='rejected',rejected_by=$1,rejected_at=now(),approval_notes=$2 WHERE id=$3 RETURNING *`, [req.user.id, notes, job.id])).rows[0];
            await client.query(`INSERT INTO bulk_import_approval_events(job_id,step_index,step_name,action,notes,actor_user_id) VALUES($1,$2,$3,'rejected',$4,$5)`, [job.id, index, step.name, notes, req.user.id]);
            return { job: updated, action: 'rejected', step };
        }
        if (decision === 'return') {
            const updated = (await client.query(`UPDATE bulk_import_jobs SET status='review',approval_step_index=0,approval_snapshot='[]'::jsonb,approval_notes=$1 WHERE id=$2 RETURNING *`, [notes, job.id])).rows[0];
            await client.query(`INSERT INTO bulk_import_approval_events(job_id,step_index,step_name,action,notes,actor_user_id) VALUES($1,$2,$3,'returned',$4,$5)`, [job.id, index, step.name, notes, req.user.id]);
            return { job: updated, action: 'returned', step };
        }
        await client.query(`INSERT INTO bulk_import_approval_events(job_id,step_index,step_name,action,notes,actor_user_id) VALUES($1,$2,$3,'approved',$4,$5)`, [job.id, index, step.name, notes, req.user.id]);
        if (index < steps.length - 1) {
            const updated = (await client.query(`UPDATE bulk_import_jobs SET approval_step_index=$1,approval_notes=$2 WHERE id=$3 RETURNING *`, [index + 1, notes, job.id])).rows[0];
            return { job: updated, action: 'advanced', step, nextStep: steps[index + 1] };
        }
        const routed = await routeApprovedMultiDomain(client, job, req.user);
        const failed = routed.filter((item) => item.status === 'failed').length, posted = routed.filter((item) => item.status === 'posted').length;
        const finalStatus = failed ? (posted ? 'partially_posted' : 'posting_failed') : 'submitted';
        const summary = { selectedSections: routed.length, postedSections: posted, failedSections: failed, records: routed.reduce((sum, item) => sum + item.records, 0), routed };
        const updated = (await client.query(`UPDATE bulk_import_jobs SET status=$1,final_approved_by=$2,final_approved_at=now(),approval_notes=$3,submission_result=$4::jsonb,submitted_by=$2,submitted_at=CASE WHEN $1='submitted' THEN now() ELSE submitted_at END WHERE id=$5 RETURNING *`, [finalStatus, req.user.id, notes, JSON.stringify(summary), job.id])).rows[0];
        await client.query(`INSERT INTO bulk_import_approval_events(job_id,step_index,step_name,action,notes,actor_user_id) VALUES($1,$2,$3,'routed',$4,$5)`, [job.id, index, step.name, `${notes} Routed ${routed.length} section(s).`, req.user.id]);
        return { job: updated, action: failed ? 'posting_failed' : 'posted', step, routed };
    });
    await logAction({ actorUserId: req.user.id, action: `BULK_IMPORT_${result.action.toUpperCase()}`, entityType: 'BULK_IMPORT', entityId: req.params.businessId, after: { notes, routed: result.routed?.length || 0 } });
    await registerGeneratedCodes(routedGeneratedEntities(result.routed));
    res.json({ job: await reviewContext(result.job, req.user.company_id), action: result.action, nextStep: result.nextStep || null, routed: result.routed || [], message: result.action === 'posted' ? 'All approval layers completed and selected records were posted to their ERP modules.' : result.action === 'posting_failed' ? 'Approval completed, but one or more sections need destination correction before retrying.' : result.action === 'advanced' ? `Approved and moved to ${result.nextStep.name}` : `Import ${result.action}` });
}
async function postApprovedResults(req, res) {
    const result = await withTransaction(async (client) => {
        const job = (await client.query(`SELECT * FROM bulk_import_jobs WHERE business_id=$1 AND company_id=$2 AND extraction_result->>'mode'='multi_domain' AND final_approved_at IS NOT NULL AND status IN('submitted','partially_posted','posting_failed') FOR UPDATE`, [req.params.businessId, req.user.company_id])).rows[0];
        if (!job) throw Object.assign(new Error('A finally approved multi-department import is required'), { statusCode: 409 });
        const routed = await routeApprovedMultiDomain(client, job, req.user);
        const failed = routed.filter((item) => item.status === 'failed').length, posted = routed.filter((item) => item.status === 'posted').length;
        const status = failed ? (posted ? 'partially_posted' : 'posting_failed') : 'submitted';
        const summary = { selectedSections: routed.length, postedSections: posted, failedSections: failed, records: routed.reduce((sum, item) => sum + item.records, 0), routed };
        const updated = (await client.query(`UPDATE bulk_import_jobs SET status=$1,submission_result=$2::jsonb,submitted_by=CASE WHEN $1='submitted' THEN $3 ELSE submitted_by END,submitted_at=CASE WHEN $1='submitted' THEN COALESCE(submitted_at,now()) ELSE submitted_at END WHERE id=$4 RETURNING *`, [status, JSON.stringify(summary), req.user.id, job.id])).rows[0];
        return { job: updated, routed, summary };
    });
    await logAction({ actorUserId: req.user.id, action: 'BULK_IMPORT_OPERATIONAL_POST_RETRIED', entityType: 'BULK_IMPORT', entityId: req.params.businessId, after: result.summary });
    await registerGeneratedCodes(routedGeneratedEntities(result.routed));
    res.json({ job: await reviewContext(result.job, req.user.company_id), ...result.summary, message: result.summary.failedSections ? `${result.summary.postedSections} sections posted; ${result.summary.failedSections} still require correction.` : `${result.summary.postedSections} sections posted successfully.` });
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
        if (job.extraction_result?.mode === 'multi_domain') throw Object.assign(new Error('Submit this multi-department extraction through its configured layered approval workflow.'), { statusCode: 409 });
        const outcome = job.extraction_result?.mode === 'structured' ? await submitStructured(client, job, req.user) : await submitFlat(client, job, req.user);
        if (outcome.errors) { await client.query(`UPDATE bulk_import_jobs SET validation_errors=$1::jsonb WHERE id=$2`, [JSON.stringify(outcome.errors), job.id]); return outcome; }
        const compactResult = { summary: outcome.summary, customerBusinessId: outcome.customerBusinessId || null };
        await client.query(`UPDATE bulk_import_jobs SET status='submitted',file_path='',detected_columns='[]',preview_rows='[]',field_mapping='{}',submission_options='{}',validation_errors='[]',extraction_result=jsonb_build_object('mode','submitted','summary',$1::jsonb),routing_plan='[]',submission_result=$1::jsonb,submitted_by=$2,submitted_at=now() WHERE id=$3`, [JSON.stringify(compactResult), req.user.id, job.id]);
        await client.query(`UPDATE bulk_import_postings SET details='{}'::jsonb WHERE job_id=$1`, [job.id]);
        return outcome;
    });
    if (result.errors) return res.status(422).json({ error: 'Complete the review requirements before final submission', validationErrors: result.errors });
    await registerGeneratedCodes(result.generated);
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

module.exports = { upload, list, get, updateMapping: updateReview, submitForApproval, decideApproval, postApprovedResults, submit, template, remove };
