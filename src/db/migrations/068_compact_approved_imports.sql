UPDATE bulk_import_jobs j SET
 preview_rows='[]'::jsonb,
 detected_columns='[]'::jsonb,
 extraction_result=jsonb_set(
   jsonb_set(j.extraction_result,'{entityCandidates}','[]'::jsonb,true),
   '{sections}',
   COALESCE((SELECT jsonb_agg((section - 'records' - 'sourceSnapshot' - 'manualReview') || jsonb_build_object('recordCount',jsonb_array_length(COALESCE(section->'records','[]'::jsonb)))) FROM jsonb_array_elements(COALESCE(j.extraction_result->'sections','[]'::jsonb)) section),'[]'::jsonb),true)
WHERE j.final_approved_at IS NOT NULL
  AND EXISTS(SELECT 1 FROM bulk_import_reference_rows r WHERE r.job_id=j.id)
  AND j.extraction_result->>'mode'='multi_domain';
