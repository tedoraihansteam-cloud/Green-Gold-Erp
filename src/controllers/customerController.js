const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { generateForEntity } = require('../services/qrBarcodeService');
const { logAction } = require('../services/auditLogger');

/**
 * Reference implementation for "create a master record".
 * This is the pattern every other module (vendor, employee, invoice,
 * gate pass, ...) should follow:
 *   1. Generate the permanent business ID via the numbering engine
 *   2. Insert the record
 *   3. Generate its QR code + barcode
 *   4. Write an audit log entry
 * all inside one transaction so a failure at any step rolls back cleanly.
 */
async function createCustomer(req, res) {
    const { name, phone, email, address, customerType, entityKind, creditPeriodDays, defaultRentPerUnit, penaltyPercent, penaltyGraceDays } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'name is required' });
    }

    try {
        const customer = await withTransaction(async (client) => {
            const businessId = await generateNextId('CUSTOMER');

            const { rows } = await client.query(
                `INSERT INTO master_customers (business_id, company_id, name, phone, email, address, customer_type, entity_kind, credit_period_days, default_rent_per_unit, penalty_percent, penalty_grace_days)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                 RETURNING *`,
                [businessId, req.user.company_id, name, phone || null, email || null, address || null, customerType || null, entityKind || 'individual', Number(creditPeriodDays) || 0, defaultRentPerUnit || null, penaltyPercent || 0, penaltyGraceDays || 0]
            );
            return rows[0];
        });

        await generateForEntity('CUSTOMER', customer.business_id);

        await logAction({
            actorUserId: req.user.id,
            action: 'CUSTOMER_CREATED',
            entityType: 'CUSTOMER',
            entityId: customer.business_id,
            after: customer
        });

        res.status(201).json({ customer });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Failed to create customer' });
    }
}

async function listCustomers(req, res) {
    const { rows } = await query(
        `SELECT * FROM master_customers WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
        [req.user.company_id]
    );
    res.json({ customers: rows });
}

async function getCustomer(req, res) {
    const { rows } = await query(
        `SELECT * FROM master_customers WHERE business_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [req.params.businessId, req.user.company_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    const customer = rows[0];
    const [receivables, contracts, batches, invoices, payments, requests, deliveries, goodsReceipts, releases, documents] = await Promise.all([
        query(`SELECT *, GREATEST(original_amount-paid_amount,0) AS outstanding,
              CASE WHEN status IN ('unpaid','partial') AND due_date<CURRENT_DATE THEN GREATEST(original_amount-paid_amount,0) * $2 / 100 ELSE 0 END AS estimated_penalty
              FROM customer_receivables WHERE customer_id=$1 AND cancelled_at IS NULL ORDER BY created_at DESC`, [customer.id, customer.penalty_percent]),
        query(`SELECT sc.*,rp.name AS policy_name,sl.name AS location_name FROM storage_contracts sc JOIN rental_policies rp ON rp.id=sc.rental_policy_id JOIN storage_locations sl ON sl.id=sc.storage_location_id WHERE sc.customer_id=$1 ORDER BY sc.created_at DESC`,[customer.id]),
        query(`SELECT pb.business_id,p.name AS product_name,pb.received_quantity,pb.available_quantity,pb.status,pb.received_at,pb.located_at FROM product_batches pb JOIN products p ON p.id=pb.product_id WHERE pb.owner_customer_id=$1 ORDER BY pb.created_at DESC`,[customer.id]),
        query(`SELECT ui.business_id,ui.issued_at AS invoice_date,ui.current_total AS total_amount,
              CASE WHEN ui.invoice_type='CUSTOMER_PAYMENT_RECEIPT' THEN 'received' WHEN ui.status IN('paid','partial') THEN ui.status ELSE 'unpaid' END AS payment_status,
              NULL::date AS due_date,ui.invoice_type,ui.source_id,ui.status,ui.review_status
              FROM unified_invoices ui WHERE ui.customer_id=$1 ORDER BY ui.issued_at DESC`,[customer.id]),
        query(`SELECT business_id,amount,payment_date,reference FROM customer_payments WHERE customer_id=$1 ORDER BY payment_date DESC`,[customer.id]),
        query(`SELECT pr.business_id,pr.request_type,pr.subject,pr.status,pr.details,pr.requested_date,pr.created_at FROM portal_requests pr JOIN users u ON u.id=pr.requester_user_id WHERE u.linked_customer_id=$1 ORDER BY pr.created_at DESC`,[customer.id]),
        query(`SELECT d.business_id,d.status,d.scheduled_date,d.delivered_at,d.delivery_address,v.vehicle_number,v.driver_name,v.driver_phone,gp.business_id gate_pass_business_id FROM deliveries d LEFT JOIN delivery_vehicles v ON v.id=d.vehicle_id LEFT JOIN gate_passes gp ON gp.id=d.gate_pass_id WHERE d.customer_id=$1 ORDER BY d.created_at DESC`,[customer.id]),
        query(`SELECT gr.business_id,pb.business_id batch_business_id,gr.received_quantity,gr.rent_rate,gr.billing_cycle,gr.labor_amount,gr.service_amount,gr.created_at FROM goods_receipts gr JOIN product_batches pb ON pb.id=gr.batch_id WHERE gr.customer_id=$1 ORDER BY gr.created_at DESC`,[customer.id]),
        query(`SELECT sr.business_id,pb.business_id batch_business_id,sr.quantity,sr.previous_quantity,sr.remaining_quantity,sr.labor_amount,sr.service_amount,sr.created_at FROM stock_release_documents sr JOIN product_batches pb ON pb.id=sr.batch_id WHERE sr.customer_id=$1 ORDER BY sr.created_at DESC`,[customer.id]),
        query(`SELECT business_id,document_type,source_type,source_id,amount,created_at FROM financial_documents WHERE customer_id=$1 ORDER BY created_at DESC`,[customer.id])
    ]);
    res.json({ customer, history:{receivables:receivables.rows,contracts:contracts.rows,batches:batches.rows,invoices:invoices.rows,payments:payments.rows,requests:requests.rows,deliveries:deliveries.rows,goodsReceipts:goodsReceipts.rows,stockReleases:releases.rows,financialDocuments:documents.rows} });
}

async function billingContext(req,res){
    const {rows:customers}=await query(`SELECT * FROM master_customers WHERE business_id=$1 AND company_id=$2 AND deleted_at IS NULL`,[req.params.businessId,req.user.company_id]);
    if(!customers.length)return res.status(404).json({error:'Customer not found'});const c=customers[0];
    const [dues,batches,contracts,charges,payments]=await Promise.all([
      query(`SELECT cr.*,cr.original_amount-cr.paid_amount outstanding_amount,GREATEST(CURRENT_DATE-cr.due_date,0) days_overdue,
        CASE WHEN cr.status IN('unpaid','partial') AND CURRENT_DATE>cr.due_date+$2::integer THEN (cr.original_amount-cr.paid_amount)*$3::numeric/100 ELSE 0 END penalty_amount
        FROM customer_receivables cr WHERE cr.customer_id=$1 AND cr.status IN('unpaid','partial') AND cr.cancelled_at IS NULL ORDER BY cr.due_date`,[c.id,c.penalty_grace_days,c.penalty_percent]),
      query(`SELECT pb.business_id,p.business_id product_business_id,p.name,p.unit,pb.available_quantity,pb.rent_per_unit_per_cycle,pb.billing_cycle,pb.status,
        COALESCE(json_agg(json_build_object('id',sl.business_id,'name',sl.name,'quantity',blb.quantity)) FILTER(WHERE blb.quantity>0),'[]') locations
        FROM product_batches pb JOIN products p ON p.id=pb.product_id LEFT JOIN batch_location_balances blb ON blb.batch_id=pb.id LEFT JOIN storage_locations sl ON sl.id=blb.location_id
        WHERE pb.owner_customer_id=$1 AND pb.available_quantity>0 GROUP BY pb.id,p.id ORDER BY p.name`,[c.id]),
      query(`SELECT sc.business_id,rp.name policy_name,rp.rate_per_unit_per_cycle,rp.billing_cycle,sc.unit_quantity,sc.status FROM storage_contracts sc JOIN rental_policies rp ON rp.id=sc.rental_policy_id WHERE sc.customer_id=$1 ORDER BY sc.created_at DESC`,[c.id]),
      query(`SELECT business_id,charge_type,description,amount,charge_date FROM customer_charges WHERE customer_id=$1 AND status='posted' ORDER BY charge_date DESC`,[c.id]),
      query(`SELECT business_id,amount,payment_date,reference FROM customer_payments WHERE customer_id=$1 ORDER BY payment_date DESC LIMIT 10`,[c.id])
    ]);
    const currentDue=dues.rows.reduce((n,r)=>n+Number(r.outstanding_amount),0),penalty=dues.rows.reduce((n,r)=>n+Number(r.penalty_amount),0);
    res.json({customer:c,summary:{currentDue,penalty,totalPayable:currentDue+penalty},dues:dues.rows,batches:batches.rows,contracts:contracts.rows,charges:charges.rows,payments:payments.rows});
}

module.exports = { createCustomer, listCustomers, getCustomer, billingContext };
