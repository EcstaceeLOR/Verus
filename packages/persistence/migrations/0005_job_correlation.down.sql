DROP INDEX IF EXISTS job_results_correlation_idx;
ALTER TABLE job_results
  DROP CONSTRAINT IF EXISTS job_results_correlation_id_format,
  DROP COLUMN IF EXISTS correlation_id;

DROP INDEX IF EXISTS jobs_correlation_idx;
ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_correlation_id_format,
  DROP COLUMN IF EXISTS correlation_id;
