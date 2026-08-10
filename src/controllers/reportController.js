const { query } = require('../config/db');

// Reports never store anything of their own - every number here is
// computed live from the same tables the operational modules already
// write to, the same principle as the Budget module's variance
// calculation. A report can never show stale data because there's
// nothing to go stale.

function resolveDateRange(req) {
    const now = new Date();
    // Build the first day as a calendar string. Converting a local midnight
    // through toISOString can move it into the previous month in UTC+
    // timezones such as Bangladesh.
    const defaultStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const defaultEnd = now.toISOString().slice(0, 10);
    return {
        startDate: req.query.startDate || defaultStart,
        endDate: req.query.endDate || defaultEnd
    };
}

async function salesSummary(req, res) {
    const { startDate, endDate } = resolveDateRange(req);
    const companyId = req.user.company_id;

    const [totals, topCustomers, topProducts] = await Promise.all([
        query(
            `SELECT count(*) AS invoice_count, COALESCE(sum(total), 0) AS total_revenue
             FROM sales_invoices
             WHERE company_id = $1 AND status = 'issued' AND created_at::date BETWEEN $2 AND $3`,
            [companyId, startDate, endDate]
        ),
        query(
            `SELECT c.business_id, c.name, count(*) AS invoice_count, sum(si.total) AS total_revenue
             FROM sales_invoices si JOIN master_customers c ON c.id = si.customer_id
             WHERE si.company_id = $1 AND si.status = 'issued' AND si.created_at::date BETWEEN $2 AND $3
             GROUP BY c.id, c.business_id, c.name
             ORDER BY total_revenue DESC LIMIT 5`,
            [companyId, startDate, endDate]
        ),
        query(
            `SELECT p.business_id, p.name, p.unit, sum(sii.quantity) AS total_quantity, sum(sii.line_total) AS total_revenue
             FROM sales_invoice_items sii
             JOIN sales_invoices si ON si.id = sii.invoice_id
             JOIN products p ON p.id = sii.product_id
             WHERE si.company_id = $1 AND si.status = 'issued' AND si.created_at::date BETWEEN $2 AND $3
             GROUP BY p.id, p.business_id, p.name, p.unit
             ORDER BY total_quantity DESC LIMIT 5`,
            [companyId, startDate, endDate]
        )
    ]);

    res.json({
        startDate, endDate,
        invoiceCount: Number(totals.rows[0].invoice_count),
        totalRevenue: Number(totals.rows[0].total_revenue),
        topCustomers: topCustomers.rows,
        topProducts: topProducts.rows
    });
}

async function inventoryStatus(req, res) {
    const { rows } = await query(
        `SELECT p.business_id, p.name, p.unit, p.reorder_level,
                COALESCE(sb.total_quantity, 0) AS current_stock,
                (p.reorder_level > 0 AND COALESCE(sb.total_quantity, 0) <= p.reorder_level) AS low_stock
         FROM products p
         LEFT JOIN (
             SELECT product_id, sum(quantity) AS total_quantity FROM stock_balances GROUP BY product_id
         ) sb ON sb.product_id = p.id
         WHERE p.company_id = $1 AND p.deleted_at IS NULL
         ORDER BY low_stock DESC, p.name`,
        [req.user.company_id]
    );

    res.json({
        products: rows,
        lowStockCount: rows.filter((r) => r.low_stock).length
    });
}

async function financialSummary(req, res) {
    const { startDate, endDate } = resolveDateRange(req);
    const companyId = req.user.company_id;

    const [salesRevenue, coldStorageRevenue, expenseTotal, payrollTotal] = await Promise.all([
        query(`SELECT COALESCE(sum(total), 0) AS total FROM sales_invoices WHERE company_id = $1 AND status = 'issued' AND created_at::date BETWEEN $2 AND $3`, [companyId, startDate, endDate]),
        query(`SELECT COALESCE(sum(total), 0) AS total FROM cold_storage_invoices WHERE company_id = $1 AND status = 'issued' AND created_at::date BETWEEN $2 AND $3`, [companyId, startDate, endDate]),
        query(`SELECT COALESCE(sum(amount), 0) AS total FROM expenses WHERE company_id = $1 AND status = 'approved' AND expense_date BETWEEN $2 AND $3`, [companyId, startDate, endDate]),
        query(
            `SELECT COALESCE(sum(pi.net_pay), 0) AS total
             FROM payroll_items pi JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
             WHERE pr.company_id = $1 AND pr.status = 'processed' AND pr.processed_at::date BETWEEN $2 AND $3`,
            [companyId, startDate, endDate]
        )
    ]);

    const revenue = Number(salesRevenue.rows[0].total) + Number(coldStorageRevenue.rows[0].total);
    const expenses = Number(expenseTotal.rows[0].total);
    const payroll = Number(payrollTotal.rows[0].total);

    res.json({
        startDate, endDate,
        salesRevenue: Number(salesRevenue.rows[0].total),
        coldStorageRevenue: Number(coldStorageRevenue.rows[0].total),
        totalRevenue: revenue,
        expenses,
        payroll,
        netPosition: revenue - expenses - payroll
    });
}

async function coldStorageOccupancy(req, res) {
    const { startDate, endDate } = resolveDateRange(req);
    const companyId = req.user.company_id;

    const [activeContracts, byLocation, revenue] = await Promise.all([
        query(`SELECT count(*) AS count FROM storage_contracts WHERE company_id = $1 AND status = 'active'`, [companyId]),
        query(
            `SELECT sl.business_id, sl.name, sl.location_type, sl.capacity_unit, sl.capacity_value,
                    COALESCE(sum(sc.unit_quantity), 0) AS occupied_quantity
             FROM storage_locations sl
             LEFT JOIN storage_contracts sc ON sc.storage_location_id = sl.id AND sc.status = 'active'
             WHERE sl.company_id = $1 AND sl.deleted_at IS NULL
             GROUP BY sl.id, sl.business_id, sl.name, sl.location_type, sl.capacity_unit, sl.capacity_value
             ORDER BY sl.name`,
            [companyId]
        ),
        query(`SELECT COALESCE(sum(total), 0) AS total FROM cold_storage_invoices WHERE company_id = $1 AND status = 'issued' AND created_at::date BETWEEN $2 AND $3`, [companyId, startDate, endDate])
    ]);

    res.json({
        startDate, endDate,
        activeContracts: Number(activeContracts.rows[0].count),
        revenueInPeriod: Number(revenue.rows[0].total),
        byLocation: byLocation.rows
    });
}

async function deliveryPerformance(req, res) {
    const { startDate, endDate } = resolveDateRange(req);
    const { rows } = await query(
        `SELECT d.status, count(*)::int AS count
         FROM deliveries d
         WHERE d.company_id = $1 AND d.created_at::date BETWEEN $2 AND $3
         GROUP BY d.status`,
        [req.user.company_id, startDate, endDate]
    );
    const counts = Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
    const total = rows.reduce((sum, row) => sum + Number(row.count), 0);
    const delivered = counts.delivered || 0;
    res.json({
        startDate,
        endDate,
        total,
        scheduled: counts.scheduled || 0,
        inTransit: counts.in_transit || 0,
        delivered,
        failed: counts.failed || 0,
        deliveryRate: total ? Math.round((delivered / total) * 10000) / 100 : 0
    });
}

async function customerMonthlyStatement(req,res){const month=/^\d{4}-\d{2}$/.test(req.query.month||'')?req.query.month:new Date().toISOString().slice(0,7);const start=`${month}-01`;const {rows:c}=await query(`SELECT id,business_id,name FROM master_customers WHERE business_id=$1 AND company_id=$2`,[req.params.customerBusinessId,req.user.company_id]);if(!c.length)return res.status(404).json({error:'Customer not found'});const [stock,dues,payments,receipts,releases]=await Promise.all([query(`SELECT pb.business_id,p.name,p.unit,pb.received_quantity,pb.available_quantity,pb.rent_per_unit_per_cycle,pb.billing_cycle,pb.created_at::date received_date FROM product_batches pb JOIN products p ON p.id=pb.product_id WHERE pb.owner_customer_id=$1 ORDER BY p.name`,[c[0].id]),query(`SELECT source_type,source_id,description,original_amount,paid_amount,due_date,status FROM customer_receivables WHERE customer_id=$1 AND date_trunc('month',created_at)=date_trunc('month',$2::date) ORDER BY created_at`,[c[0].id,start]),query(`SELECT business_id,amount,payment_date,reference FROM customer_payments WHERE customer_id=$1 AND date_trunc('month',payment_date)=date_trunc('month',$2::date)`,[c[0].id,start]),query(`SELECT gr.business_id,pb.business_id batch_business_id,gr.received_quantity,gr.rent_rate,gr.labor_amount,gr.service_amount,gr.created_at FROM goods_receipts gr JOIN product_batches pb ON pb.id=gr.batch_id WHERE gr.customer_id=$1 AND date_trunc('month',gr.created_at)=date_trunc('month',$2::date)`,[c[0].id,start]),query(`SELECT sr.business_id,pb.business_id batch_business_id,sr.quantity,sr.remaining_quantity,sr.created_at FROM stock_release_documents sr JOIN product_batches pb ON pb.id=sr.batch_id WHERE sr.customer_id=$1 AND date_trunc('month',sr.created_at)=date_trunc('month',$2::date)`,[c[0].id,start])]);const currentCharges=dues.rows.reduce((n,x)=>n+Number(x.original_amount),0),paid=payments.rows.reduce((n,x)=>n+Number(x.amount),0);const allDue=(await query(`SELECT COALESCE(sum(original_amount-paid_amount) FILTER(WHERE status IN('unpaid','partial')),0) total FROM customer_receivables WHERE customer_id=$1`,[c[0].id])).rows[0].total;res.json({month,customer:c[0],summary:{currentCharges,payments:paid,totalOutstanding:Number(allDue)},stock:stock.rows,goodsReceived:receipts.rows,releases:releases.rows,dues:dues.rows,payments:payments.rows});}

async function operationalDaily(req,res){const date=req.query.date||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka'}).format(new Date()),company=req.user.company_id,sections={};
 if(req.permissions.has('ACCOUNTS_VIEW')){sections.accounts=(await query(`SELECT at.transaction_type,at.amount,at.reference_type,at.reference_id,at.notes,at.created_at,a.business_id account_business_id,a.name account_name FROM account_transactions at JOIN accounts a ON a.id=at.account_id WHERE a.company_id=$1 AND at.created_at::date=$2 ORDER BY at.created_at`,[company,date])).rows;sections.expenses=(await query(`SELECT e.business_id,e.amount,e.description,e.paid_to,e.status,ec.name category,a.name account_name FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id JOIN accounts a ON a.id=e.account_id WHERE e.company_id=$1 AND e.expense_date=$2 ORDER BY e.created_at`,[company,date])).rows;}
 if(req.permissions.has('INVENTORY_VIEW')){sections.receiving=(await query(`SELECT gr.business_id,pb.business_id batch_business_id,p.name product_name,gr.received_quantity,p.unit,c.name customer_name,gr.created_at FROM goods_receipts gr JOIN product_batches pb ON pb.id=gr.batch_id JOIN products p ON p.id=pb.product_id LEFT JOIN master_customers c ON c.id=gr.customer_id WHERE gr.company_id=$1 AND gr.created_at::date=$2 ORDER BY gr.created_at`,[company,date])).rows;sections.stockReleases=(await query(`SELECT sr.business_id,pb.business_id batch_business_id,p.name product_name,sr.quantity,sr.remaining_quantity,sr.created_at FROM stock_release_documents sr JOIN product_batches pb ON pb.id=sr.batch_id JOIN products p ON p.id=pb.product_id WHERE sr.company_id=$1 AND sr.created_at::date=$2 ORDER BY sr.created_at`,[company,date])).rows;}
 if(req.permissions.has('LOGISTICS_VIEW'))sections.deliveries=(await query(`SELECT d.business_id,d.status,d.delivery_address,d.scheduled_date,d.dispatched_at,d.delivered_at,v.vehicle_number,c.name customer_name FROM deliveries d JOIN master_customers c ON c.id=d.customer_id LEFT JOIN delivery_vehicles v ON v.id=d.vehicle_id WHERE d.company_id=$1 AND (d.created_at::date=$2 OR d.dispatched_at::date=$2 OR d.delivered_at::date=$2) ORDER BY d.created_at`,[company,date])).rows;
 if(req.permissions.has('SECURITY_VIEW'))sections.gatePasses=(await query(`SELECT business_id,pass_type,status,vehicle_number,contact_name,description,created_at,exit_confirmed_at,exit_note FROM gate_passes WHERE company_id=$1 AND (created_at::date=$2 OR exit_confirmed_at::date=$2) ORDER BY created_at`,[company,date])).rows;
 if(req.permissions.has('HR_VIEW')){sections.attendance=(await query(`SELECT u.username,COALESCE(e.full_name,u.display_name,u.username) staff_name,$2::date attendance_date,CASE WHEN COUNT(a.id)=0 THEN 'absent' WHEN BOOL_OR(a.clock_out_at IS NULL) THEN 'clocked_in' ELSE 'clocked_out' END status,MIN(a.clock_in_at) clock_in_at,MAX(a.clock_out_at) clock_out_at,string_agg(DISTINCT a.attendance_mode,', ' ORDER BY a.attendance_mode) attendance_mode,ROUND((COALESCE(SUM(EXTRACT(EPOCH FROM(COALESCE(a.clock_out_at,now())-a.clock_in_at))),0)/3600)::numeric,2) hours,MAX(a.clock_in_ip) clock_in_ip,MAX(a.clock_out_ip) clock_out_ip,MAX(a.location_address) location_address FROM users u LEFT JOIN master_employees e ON e.id=u.linked_employee_id LEFT JOIN staff_attendance_sessions a ON a.user_id=u.id AND a.company_id=$1 AND a.attendance_date=$2 WHERE u.company_id=$1 AND u.account_type='staff' AND u.status='active' AND u.deleted_at IS NULL GROUP BY u.id,e.id ORDER BY staff_name`,[company,date])).rows;sections.tasks=(await query(`SELECT t.business_id,t.title,t.description,t.status,t.priority,t.progress_percent,t.due_date,t.created_at,t.updated_at,t.completed_at,COALESCE(e.full_name,u.display_name,u.username) assignee,creator.username assigned_by,COALESCE(sum(EXTRACT(EPOCH FROM(COALESCE(te.stopped_at,now())-te.started_at))/60),0)::int logged_minutes,MIN(te.started_at) first_started_at,MAX(te.stopped_at) last_stopped_at FROM staff_tasks t JOIN users u ON u.id=t.assignee_user_id JOIN users creator ON creator.id=t.assigned_by LEFT JOIN master_employees e ON e.id=u.linked_employee_id LEFT JOIN staff_task_time_entries te ON te.task_id=t.id WHERE t.company_id=$1 AND t.status<>'cancelled' GROUP BY t.id,u.id,e.id,creator.id ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'assigned' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END,t.due_date NULLS LAST,t.created_at`,[company])).rows;}
 if(req.permissions.has('MANUFACTURING_VIEW')){sections.machineIncidents=(await query(`SELECT mi.business_id,m.name machine_name,mi.incident_type,mi.severity,mi.status,mi.description,mi.reported_at,mi.resolved_at,mi.resolution_notes FROM machine_incidents mi LEFT JOIN machines m ON m.id=mi.machine_id WHERE mi.company_id=$1 AND (mi.reported_at::date=$2 OR mi.resolved_at::date=$2) ORDER BY mi.reported_at`,[company,date])).rows;sections.maintenance=(await query(`SELECT m.name machine_name,ms.maintenance_type,ms.scheduled_date,ms.completed_date,ms.status,ms.notes FROM machine_maintenance_schedule ms JOIN machines m ON m.id=ms.machine_id WHERE m.company_id=$1 AND (ms.scheduled_date=$2 OR ms.completed_date=$2) ORDER BY m.name`,[company,date])).rows;}
 if(req.permissions.has('USER_MANAGEMENT_VIEW'))sections.requests=(await query(`SELECT pr.business_id,pr.request_type,pr.department,pr.subject,pr.status,pr.created_at,u.username requester FROM portal_requests pr JOIN users u ON u.id=pr.requester_user_id WHERE pr.company_id=$1 AND (pr.created_at::date=$2 OR pr.reviewed_at::date=$2) ORDER BY pr.created_at`,[company,date])).rows;
 res.json({date,sections,availableSections:Object.keys(sections)});}

module.exports = { salesSummary, inventoryStatus, financialSummary, coldStorageOccupancy, deliveryPerformance, customerMonthlyStatement,operationalDaily };
