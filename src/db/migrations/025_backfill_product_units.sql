UPDATE product_batches pb SET receiving_warehouse_id=x.warehouse_id,located_at=COALESCE(pb.located_at,pb.created_at)
FROM (SELECT DISTINCT ON(blb.batch_id) blb.batch_id,sl.warehouse_id FROM batch_location_balances blb JOIN storage_locations sl ON sl.id=blb.location_id WHERE blb.quantity>0 ORDER BY blb.batch_id,blb.updated_at) x
WHERE pb.id=x.batch_id AND pb.receiving_warehouse_id IS NULL;

INSERT INTO product_batch_units(batch_id,unit_number,business_id,status,location_id)
SELECT pb.id,n,concat(pb.business_id,'-U',lpad(n::text,6,'0')),CASE WHEN loc.location_id IS NULL THEN 'received' ELSE 'stored' END,loc.location_id
FROM product_batches pb CROSS JOIN LATERAL generate_series(1,floor(pb.received_quantity)::integer) n
LEFT JOIN LATERAL (SELECT blb.location_id FROM batch_location_balances blb WHERE blb.batch_id=pb.id AND blb.quantity>0 ORDER BY blb.updated_at LIMIT 1) loc ON true
ON CONFLICT(batch_id,unit_number) DO NOTHING;
