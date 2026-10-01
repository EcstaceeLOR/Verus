ALTER TABLE jobs ADD COLUMN correlation_id text;

UPDATE jobs
SET correlation_id = 'legacy_' || md5(workspace_id || ':' || job_id)
WHERE correlation_id IS NULL;

ALTER TABLE jobs
  ALTER COLUMN correlation_id SET NOT NULL,
  ADD CONSTRAINT jobs_correlation_id_format
    CHECK (correlation_id ~ '^[A-Za-z0-9_-]{8,128}$');

CREATE INDEX jobs_correlation_idx ON jobs (workspace_id, correlation_id, created_at);

ALTER TABLE job_results ADD COLUMN correlation_id text;

UPDATE job_results result
SET correlation_id = job.correlation_id
FROM jobs job
WHERE result.workspace_id = job.workspace_id
  AND result.job_id = job.job_id
  AND result.correlation_id IS NULL;

ALTER TABLE job_results
  ALTER COLUMN correlation_id SET NOT NULL,
  ADD CONSTRAINT job_results_correlation_id_format
    CHECK (correlation_id ~ '^[A-Za-z0-9_-]{8,128}$');

CREATE INDEX job_results_correlation_idx ON job_results (workspace_id, correlation_id, committed_at);
