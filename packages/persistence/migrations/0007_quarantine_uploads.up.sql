CREATE TABLE quarantine_uploads (
  workspace_id text NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  upload_id text NOT NULL,
  object_ref text NOT NULL CHECK (object_ref ~ '^quarantine://sha256/[0-9a-f]{64}$'),
  digest text NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  declared_media_type text NOT NULL,
  detected_media_type text,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 104857600),
  state text NOT NULL CHECK (state IN ('clean', 'malicious', 'rejected', 'scan_unavailable')),
  scanner_version text,
  failure_code text,
  quarantined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retention_until timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, upload_id),
  UNIQUE (workspace_id, digest),
  CHECK (upload_id ~ '^upload_[0-9A-HJKMNP-TV-Z]{26}$'),
  CHECK ((state = 'clean') = (failure_code IS NULL))
);

CREATE INDEX quarantine_uploads_retention_idx
  ON quarantine_uploads (workspace_id, retention_until, upload_id) WHERE deleted_at IS NULL;

ALTER TABLE quarantine_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarantine_uploads FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON quarantine_uploads
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), ''))
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), ''));
