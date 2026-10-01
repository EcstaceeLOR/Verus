ALTER TABLE scans ADD COLUMN idempotency_key text;
ALTER TABLE scans ADD COLUMN request_digest text;

UPDATE scans
SET idempotency_key = request_id,
    request_digest = input_digest
WHERE idempotency_key IS NULL OR request_digest IS NULL;

ALTER TABLE scans
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN request_digest SET NOT NULL,
  ADD CONSTRAINT scans_idempotency_key_format
    CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$'),
  ADD CONSTRAINT scans_request_digest_format
    CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT scans_workspace_idempotency_key_unique
    UNIQUE (workspace_id, idempotency_key);

CREATE TABLE ingestion_envelopes (
  workspace_id text NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  envelope_id text NOT NULL,
  scan_id text NOT NULL,
  request_id text NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  input_digest text NOT NULL CHECK (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  input_kind text NOT NULL CHECK (input_kind IN ('url', 'text', 'upload', 'feed_event')),
  media_type text,
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
  envelope jsonb NOT NULL CHECK (jsonb_typeof(envelope) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, envelope_id),
  UNIQUE (workspace_id, scan_id),
  FOREIGN KEY (workspace_id, scan_id) REFERENCES scans(workspace_id, scan_id) ON DELETE RESTRICT,
  CHECK (envelope_id ~ '^env_[0-9A-HJKMNP-TV-Z]{26}$'),
  CHECK (request_id ~ '^req_[0-9A-HJKMNP-TV-Z]{26}$')
);

CREATE INDEX ingestion_envelopes_workspace_created_idx
  ON ingestion_envelopes (workspace_id, created_at DESC, envelope_id);

ALTER TABLE ingestion_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_envelopes FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON ingestion_envelopes
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), ''))
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), ''));
