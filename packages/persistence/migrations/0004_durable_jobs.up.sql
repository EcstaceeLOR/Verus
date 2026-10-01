ALTER TABLE jobs
  ADD COLUMN queue_name text NOT NULL DEFAULT 'trusted',
  ADD COLUMN envelope_version integer NOT NULL DEFAULT 1,
  ADD COLUMN timeout_ms integer NOT NULL DEFAULT 900000,
  ADD COLUMN deadline_at timestamptz,
  ADD COLUMN effect_key text,
  ADD COLUMN lease_token text,
  ADD COLUMN execution_expires_at timestamptz,
  ADD COLUMN cancel_requested_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN result_ref text,
  ADD COLUMN result_digest text,
  ADD COLUMN last_error_retryable boolean,
  ADD COLUMN replayed_from_job_id text;

UPDATE jobs
SET deadline_at = created_at + interval '24 hours',
    effect_key = left(kind || ':' || idempotency_key, 256),
    completed_at = CASE
      WHEN state IN ('succeeded', 'dead_lettered', 'cancelled') THEN updated_at
      ELSE NULL
    END;

UPDATE jobs
SET state = 'retry_wait', available_at = clock_timestamp(), lease_owner = NULL,
    lease_expires_at = NULL, last_error_code = 'JOB_LEASE_EXPIRED',
    last_error_retryable = true, updated_at = clock_timestamp()
WHERE state = 'leased';

UPDATE jobs
SET last_error_retryable = CASE WHEN state = 'retry_wait' THEN true ELSE false END
WHERE last_error_code IS NOT NULL AND last_error_retryable IS NULL;

ALTER TABLE jobs
  ALTER COLUMN deadline_at SET NOT NULL,
  ALTER COLUMN effect_key SET NOT NULL,
  ADD CONSTRAINT jobs_replayed_from_fk
    FOREIGN KEY (workspace_id, replayed_from_job_id)
    REFERENCES jobs(workspace_id, job_id) ON DELETE RESTRICT,
  ADD CONSTRAINT jobs_queue_name_format
    CHECK (queue_name ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  ADD CONSTRAINT jobs_kind_format
    CHECK (kind ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  ADD CONSTRAINT jobs_envelope_version_range
    CHECK (envelope_version BETWEEN 1 AND 1000),
  ADD CONSTRAINT jobs_timeout_range
    CHECK (timeout_ms BETWEEN 1000 AND 3600000),
  ADD CONSTRAINT jobs_effect_key_format
    CHECK (effect_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$'),
  ADD CONSTRAINT jobs_lease_invariant
    CHECK (
      (state = 'leased') =
      (lease_owner IS NOT NULL AND lease_token IS NOT NULL
       AND lease_expires_at IS NOT NULL AND execution_expires_at IS NOT NULL)
    ),
  ADD CONSTRAINT jobs_terminal_timestamp
    CHECK ((state IN ('succeeded', 'dead_lettered', 'cancelled')) = (completed_at IS NOT NULL)),
  ADD CONSTRAINT jobs_result_pair
    CHECK ((result_ref IS NULL) = (result_digest IS NULL)),
  ADD CONSTRAINT jobs_result_digest_format
    CHECK (result_digest IS NULL OR result_digest ~ '^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT jobs_error_pair
    CHECK ((last_error_code IS NULL) = (last_error_retryable IS NULL)),
  ADD CONSTRAINT jobs_error_code_known
    CHECK (last_error_code IS NULL OR last_error_code IN (
      'JOB_CANCELLED', 'JOB_DEADLINE_EXCEEDED', 'JOB_DEPENDENCY_UNAVAILABLE',
      'JOB_HANDLER_FAILED', 'JOB_HANDLER_TIMEOUT', 'JOB_LEASE_EXPIRED',
      'JOB_PAYLOAD_UNAVAILABLE', 'JOB_UNSUPPORTED_ENVELOPE'
    ));

CREATE INDEX jobs_queue_claim_idx
  ON jobs (workspace_id, queue_name, state, available_at, created_at)
  WHERE state IN ('available', 'retry_wait');
CREATE INDEX jobs_lease_expiry_idx
  ON jobs (workspace_id, queue_name, lease_expires_at)
  WHERE state = 'leased';
CREATE INDEX jobs_dead_letter_idx
  ON jobs (workspace_id, queue_name, completed_at DESC)
  WHERE state = 'dead_lettered';

CREATE TABLE job_attempts (
  workspace_id text NOT NULL,
  job_id text NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  worker_id text NOT NULL CHECK (worker_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  lease_token text NOT NULL CHECK (
    lease_token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  started_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  finished_at timestamptz,
  outcome text CHECK (outcome IN ('succeeded', 'retry_wait', 'dead_lettered', 'cancelled')),
  error_code text CHECK (error_code IS NULL OR error_code IN (
    'JOB_CANCELLED', 'JOB_DEADLINE_EXCEEDED', 'JOB_DEPENDENCY_UNAVAILABLE',
    'JOB_HANDLER_FAILED', 'JOB_HANDLER_TIMEOUT', 'JOB_LEASE_EXPIRED',
    'JOB_PAYLOAD_UNAVAILABLE', 'JOB_UNSUPPORTED_ENVELOPE'
  )),
  PRIMARY KEY (workspace_id, job_id, attempt_number),
  FOREIGN KEY (workspace_id, job_id)
    REFERENCES jobs(workspace_id, job_id) ON DELETE RESTRICT,
  CHECK ((finished_at IS NULL) = (outcome IS NULL)),
  CHECK (heartbeat_at >= started_at),
  CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE INDEX job_attempts_active_idx
  ON job_attempts (workspace_id, heartbeat_at) WHERE finished_at IS NULL;

CREATE TABLE job_results (
  workspace_id text NOT NULL,
  effect_key text NOT NULL CHECK (effect_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,255}$'),
  job_id text NOT NULL,
  result_ref text NOT NULL,
  result_digest text NOT NULL CHECK (result_digest ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, effect_key),
  FOREIGN KEY (workspace_id, job_id)
    REFERENCES jobs(workspace_id, job_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION verus_validate_job_transition() RETURNS trigger
LANGUAGE plpgsql AS $verus$
BEGIN
  IF OLD.state = NEW.state THEN
    RETURN NEW;
  END IF;
  IF (OLD.state = 'available' AND NEW.state IN ('leased', 'cancelled', 'dead_lettered'))
     OR (OLD.state = 'retry_wait' AND NEW.state IN ('leased', 'cancelled', 'dead_lettered'))
     OR (OLD.state = 'leased' AND NEW.state IN
       ('retry_wait', 'succeeded', 'dead_lettered', 'cancelled')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid job state transition' USING ERRCODE = '55000';
END
$verus$;

CREATE TRIGGER jobs_validate_transition
  BEFORE UPDATE OF state ON jobs
  FOR EACH ROW EXECUTE FUNCTION verus_validate_job_transition();

DO $verus$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['job_attempts', 'job_results']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format(
      'CREATE POLICY workspace_isolation ON %I USING (workspace_id = nullif(current_setting(''app.workspace_id'', true), '''')) WITH CHECK (workspace_id = nullif(current_setting(''app.workspace_id'', true), ''''))',
      relation_name
    );
  END LOOP;
END
$verus$;
