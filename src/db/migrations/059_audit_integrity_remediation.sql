-- Preserve referenced master data and make historical control exceptions explicit.
UPDATE master_vendors v
SET deleted_at = NULL
WHERE deleted_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM purchase_orders po
    WHERE po.vendor_id = v.id AND po.status <> 'cancelled'
  );

UPDATE gate_passes
SET exit_note = '[Legacy record: exit note was not captured before mandatory-note control]'
WHERE status = 'exited' AND COALESCE(BTRIM(exit_note), '') = '';

INSERT INTO gate_passes(
  business_id, company_id, pass_type, source_reference_type,
  source_reference_id, description, status, issued_by,
  exit_confirmed_by, exit_confirmed_at
)
SELECT 'LEGACY-GP-' || d.business_id, d.company_id, 'OUTWARD_GOODS',
       'DELIVERY', d.business_id,
       'System-created control record for legacy delivery ' || d.business_id,
       'exited', d.created_by, COALESCE(d.dispatched_by,d.created_by),
       COALESCE(d.dispatched_at,d.delivered_at,d.created_at)
FROM deliveries d
WHERE d.gate_pass_id IS NULL AND d.status IN ('in_transit','delivered')
  AND NOT EXISTS (SELECT 1 FROM gate_passes gp WHERE gp.source_reference_type='DELIVERY' AND gp.source_reference_id=d.business_id);

UPDATE deliveries d
SET gate_pass_id = gp.id
FROM gate_passes gp
WHERE d.gate_pass_id IS NULL
  AND gp.source_reference_type='DELIVERY'
  AND gp.source_reference_id=d.business_id
  AND gp.company_id=d.company_id;

ALTER TABLE staff_attendance_sessions
  ADD COLUMN IF NOT EXISTS duration_exception BOOLEAN NOT NULL DEFAULT false;

UPDATE staff_attendance_sessions
SET duration_exception=true,
    notes=concat_ws(' | ',NULLIF(notes,''),'Legacy duration exception retained for HR review')
WHERE clock_out_at IS NOT NULL
  AND clock_out_at-clock_in_at > interval '18 hours';
