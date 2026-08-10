const { query } = require('../config/db');

const hasAny = (permissions, codes) => codes.some((code) => permissions.has(code));
const mapRows = (rows, entityType, pathFor) => rows.map((row) => ({
    entityType, businessId: row.business_id, title: row.title, subtitle: row.subtitle || '',
    status: row.status || '', path: pathFor(row.business_id), exact: row.exact_match
}));

async function universalSearch(req, res) {
    const term = String(req.query.q || '').trim().slice(0, 120);
    if (term.length < 2) return res.json({ query: term, results: [] });
    const companyId = req.user.company_id;
    const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    const params = [companyId, pattern, term];
    const jobs = [];
    const add = (entityType, pathFor, sql) => jobs.push(query(sql, params).then(({ rows }) => mapRows(rows, entityType, pathFor)));
    const masterSql = (table, title, subtitle, deleted = true) => `SELECT business_id,${title} AS title,${subtitle} AS subtitle,status,(lower(business_id)=lower($3)) AS exact_match FROM ${table} WHERE company_id=$1 ${deleted ? 'AND deleted_at IS NULL' : ''} AND (business_id ILIKE $2 ESCAPE '\\' OR ${title} ILIKE $2 ESCAPE '\\' OR ${subtitle} ILIKE $2 ESCAPE '\\') ORDER BY exact_match DESC,created_at DESC LIMIT 6`;

    if (hasAny(req.permissions, ['SALES_VIEW','COLD_STORAGE_VIEW','ACCOUNTS_VIEW']) || req.user.account_type === 'customer') {
        const own = req.user.account_type === 'customer' ? ' AND id=(SELECT linked_customer_id FROM users WHERE id=$4)' : '';
        const customerParams = req.user.account_type === 'customer' ? [...params, req.user.id] : params;
        jobs.push(query(`SELECT business_id,name AS title,concat_ws(' · ',phone,email,customer_type) AS subtitle,status,(lower(business_id)=lower($3)) AS exact_match FROM master_customers WHERE company_id=$1 AND deleted_at IS NULL${own} AND (business_id ILIKE $2 ESCAPE '\\' OR name ILIKE $2 ESCAPE '\\' OR COALESCE(phone,'') ILIKE $2 ESCAPE '\\' OR COALESCE(email,'') ILIKE $2 ESCAPE '\\') ORDER BY exact_match DESC,created_at DESC LIMIT 6`, customerParams).then(({rows})=>mapRows(rows,'Customer',(id)=>`/customers/${id}`)));
    }
    if (req.permissions.has('INVENTORY_VIEW')) {
        add('Vendor',(id)=>`/vendors/${id}`,masterSql('master_vendors','name',`concat_ws(' · ',phone,email,vendor_type)`));
        add('Product',()=>'/inventory/products',masterSql('products','name',`concat_ws(' · ',sku,category,unit)`));
        add('Warehouse',()=>'/inventory/warehouses',`SELECT business_id,name AS title,COALESCE(location_notes,'') AS subtitle,'active' AS status,(lower(business_id)=lower($3)) AS exact_match FROM warehouses WHERE company_id=$1 AND deleted_at IS NULL AND (business_id ILIKE $2 ESCAPE '\\' OR name ILIKE $2 ESCAPE '\\' OR COALESCE(location_notes,'') ILIKE $2 ESCAPE '\\') ORDER BY exact_match DESC,created_at DESC LIMIT 6`);
        add('Purchase order',(id)=>`/procurement/purchase-orders/${id}`,`SELECT po.business_id,v.name AS title,concat('Purchase order · ',po.total,' · ',po.payment_status) AS subtitle,po.status,(lower(po.business_id)=lower($3)) AS exact_match FROM purchase_orders po JOIN master_vendors v ON v.id=po.vendor_id WHERE po.company_id=$1 AND (po.business_id ILIKE $2 ESCAPE '\\' OR v.name ILIKE $2 ESCAPE '\\' OR COALESCE(po.notes,'') ILIKE $2 ESCAPE '\\') ORDER BY exact_match DESC,po.created_at DESC LIMIT 6`);
    }
    if (req.permissions.has('HR_VIEW')) add('Employee',()=>'/employees',masterSql('master_employees','full_name',`concat_ws(' · ',designation,phone,email)`));
    if (hasAny(req.permissions,['SALES_VIEW','COLD_STORAGE_VIEW','INVENTORY_VIEW','LOGISTICS_VIEW','ACCOUNTS_VIEW'])) {
        const ownInvoice = '';
        const invoiceParams = params;
        jobs.push(query(`SELECT ui.business_id,COALESCE(c.name,ui.invoice_type) AS title,concat(ui.invoice_type,' · ',ui.current_total) AS subtitle,ui.status,(lower(ui.business_id)=lower($3) OR lower(ui.source_id)=lower($3)) AS exact_match FROM unified_invoices ui LEFT JOIN master_customers c ON c.id=ui.customer_id WHERE ui.company_id=$1${ownInvoice} AND (ui.business_id ILIKE $2 ESCAPE '\\' OR ui.source_id ILIKE $2 ESCAPE '\\' OR ui.invoice_type ILIKE $2 ESCAPE '\\' OR COALESCE(c.name,'') ILIKE $2 ESCAPE '\\') ORDER BY exact_match DESC,ui.issued_at DESC LIMIT 8`,invoiceParams).then(({rows})=>mapRows(rows,'Invoice',(id)=>`/invoices/${id}`)));
    }
    if (req.permissions.has('ACCOUNTS_VIEW')) add('Account',(id)=>`/accounts/${id}`,masterSql('accounts','name',`concat_ws(' · ',account_type,bank_name,bank_account_number)`));
    if (req.permissions.has('SECURITY_VIEW')) add('Gate pass',()=>'/gate-passes',`SELECT business_id,description AS title,concat_ws(' · ',pass_type,vehicle_number,contact_name) AS subtitle,status,(lower(business_id)=lower($3)) AS exact_match FROM gate_passes WHERE company_id=$1 AND (business_id ILIKE $2 ESCAPE '\\' OR description ILIKE $2 ESCAPE '\\' OR COALESCE(vehicle_number,'') ILIKE $2 ESCAPE '\\' OR COALESCE(contact_name,'') ILIKE $2 ESCAPE '\\' OR COALESCE(source_reference_id,'') ILIKE $2 ESCAPE '\\') ORDER BY exact_match DESC,created_at DESC LIMIT 6`);
    if (req.permissions.has('MANUFACTURING_VIEW')) add('Machine',(id)=>`/manufacturing/machines/${id}/history`,masterSql('machines','name',`concat_ws(' · ',machine_type,model)`));
    if (req.permissions.has('LOGISTICS_VIEW')) {
        add('Vehicle',()=>'/logistics/vehicles',masterSql('delivery_vehicles','vehicle_number',`concat_ws(' · ',vehicle_type,driver_name,driver_phone)`));
        add('Delivery',()=>'/logistics/deliveries',`SELECT d.business_id,c.name AS title,concat_ws(' · ',d.delivery_address,d.scheduled_date::text) AS subtitle,d.status,(lower(d.business_id)=lower($3)) AS exact_match FROM deliveries d JOIN master_customers c ON c.id=d.customer_id WHERE d.company_id=$1 AND (d.business_id ILIKE $2 ESCAPE '\\' OR c.name ILIKE $2 ESCAPE '\\' OR COALESCE(d.delivery_address,'') ILIKE $2 ESCAPE '\\') ORDER BY exact_match DESC,d.created_at DESC LIMIT 6`);
    }
    if (req.user.account_type !== 'customer') {
        const broadBills = hasAny(req.permissions,['ACCOUNTS_VIEW','ACCOUNTS_APPROVE','USER_MANAGEMENT_VIEW']);
        const billScope = broadBills ? '' : ' AND b.submitter_user_id=$4';
        jobs.push(query(`SELECT b.business_id,b.payee AS title,concat_ws(' · ',b.category,b.bill_number,b.amount::text) AS subtitle,b.status,(lower(b.business_id)=lower($3)) AS exact_match FROM bill_submissions b WHERE b.company_id=$1${billScope} AND (b.business_id ILIKE $2 ESCAPE '\\' OR b.payee ILIKE $2 ESCAPE '\\' OR COALESCE(b.bill_number,'') ILIKE $2 ESCAPE '\\' OR COALESCE(b.description,'') ILIKE $2 ESCAPE '\\') ORDER BY exact_match DESC,b.created_at DESC LIMIT 6`, broadBills ? params : [...params,req.user.id]).then(({rows})=>mapRows(rows,'Bill',(id)=>`/bills/${id}`)));
        const broadReq = hasAny(req.permissions,['HR_APPROVE','ACCOUNTS_APPROVE','USER_MANAGEMENT_APPROVE','USER_MANAGEMENT_VIEW']);
        const requestScope = broadReq ? '' : ' AND pr.requester_user_id=$4';
        jobs.push(query(`SELECT pr.business_id,pr.subject AS title,concat_ws(' · ',pr.request_type,pr.department) AS subtitle,pr.status,(lower(pr.business_id)=lower($3)) AS exact_match FROM portal_requests pr WHERE pr.company_id=$1${requestScope} AND (pr.business_id ILIKE $2 ESCAPE '\\' OR pr.subject ILIKE $2 ESCAPE '\\' OR pr.request_type ILIKE $2 ESCAPE '\\' OR COALESCE(pr.body,'') ILIKE $2 ESCAPE '\\') ORDER BY exact_match DESC,pr.created_at DESC LIMIT 6`, broadReq ? params : [...params,req.user.id]).then(({rows})=>mapRows(rows,'Request',()=>'/requests')));
        const broadRequisitions = hasAny(req.permissions,['INVENTORY_VIEW','USER_MANAGEMENT_VIEW','USER_MANAGEMENT_APPROVE']);
        const requisitionScope = broadRequisitions ? '' : ' AND requester_user_id=$4';
        jobs.push(query(`SELECT business_id,title,concat_ws(' · ',priority,destination_name) AS subtitle,status,(lower(business_id)=lower($3)) AS exact_match FROM purchase_requisitions WHERE company_id=$1${requisitionScope} AND (business_id ILIKE $2 ESCAPE '\\' OR title ILIKE $2 ESCAPE '\\' OR justification ILIKE $2 ESCAPE '\\' OR destination_name ILIKE $2 ESCAPE '\\') ORDER BY exact_match DESC,created_at DESC LIMIT 6`, broadRequisitions ? params : [...params,req.user.id]).then(({rows})=>mapRows(rows,'Requisition',(id)=>`/procurement/requisitions/${id}`)));
    }
    const groups = await Promise.all(jobs);
    const results = groups.flat().sort((a,b)=>Number(b.exact)-Number(a.exact) || a.entityType.localeCompare(b.entityType)).slice(0,40).map(({exact,...item})=>item);
    res.json({ query: term, results });
}

module.exports = { universalSearch };
