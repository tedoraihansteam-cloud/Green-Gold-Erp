const { query } = require('../config/db');

async function summary(req,res){
    if(!req.user.linked_customer_id)return res.status(403).json({error:'This login is not linked to a customer record'});
    const customerId=req.user.linked_customer_id;
    const [customer,receivables,payments,contracts,batches,deliveries]=await Promise.all([
        query(`SELECT business_id,name,phone,email,address,credit_period_days FROM master_customers WHERE id=$1`,[customerId]),
        query(`SELECT source_type,source_id,description,original_amount,paid_amount,original_amount-paid_amount AS outstanding_amount,due_date,status FROM customer_receivables WHERE customer_id=$1 ORDER BY due_date DESC`,[customerId]),
        query(`SELECT cp.business_id,cp.amount,cp.payment_date,cp.reference,a.name AS account_name FROM customer_payments cp JOIN accounts a ON a.id=cp.account_id WHERE cp.customer_id=$1 ORDER BY cp.payment_date DESC`,[customerId]),
        query(`SELECT sc.business_id,sc.goods_description,sc.unit_quantity,sc.start_date,sc.end_date,sc.status,sl.business_id AS location_business_id,sl.name AS location_name,rp.name AS policy_name FROM storage_contracts sc JOIN storage_locations sl ON sl.id=sc.storage_location_id JOIN rental_policies rp ON rp.id=sc.rental_policy_id WHERE sc.customer_id=$1 ORDER BY sc.created_at DESC`,[customerId]),
        query(`SELECT pb.business_id,p.business_id AS product_business_id,p.name AS product_name,p.unit,pb.available_quantity,pb.status,COALESCE(json_agg(json_build_object('locationBusinessId',sl.business_id,'locationName',sl.name,'quantity',blb.quantity)) FILTER(WHERE blb.quantity>0),'[]') AS locations FROM product_batches pb JOIN products p ON p.id=pb.product_id LEFT JOIN batch_location_balances blb ON blb.batch_id=pb.id LEFT JOIN storage_locations sl ON sl.id=blb.location_id WHERE pb.owner_customer_id=$1 GROUP BY pb.id,p.id ORDER BY pb.created_at DESC`,[customerId]),
        query(`SELECT d.business_id,d.status,d.scheduled_date,d.delivered_at,d.delivery_address,si.business_id AS invoice_business_id FROM deliveries d LEFT JOIN sales_invoices si ON si.id=d.invoice_id WHERE d.customer_id=$1 ORDER BY d.created_at DESC`,[customerId])
    ]);
    const totalDue=receivables.rows.filter(r=>!['paid','cancelled'].includes(r.status)).reduce((sum,r)=>sum+Number(r.outstanding_amount),0);
    res.json({customer:customer.rows[0],totalDue,receivables:receivables.rows,payments:payments.rows,contracts:contracts.rows,batches:batches.rows,deliveries:deliveries.rows});
}

module.exports={summary};
