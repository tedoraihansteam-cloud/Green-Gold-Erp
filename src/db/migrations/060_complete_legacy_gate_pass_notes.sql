UPDATE gate_passes
SET exit_note='[Legacy control record: generated from delivery history during integrity remediation]'
WHERE status='exited' AND COALESCE(BTRIM(exit_note),'')='';
