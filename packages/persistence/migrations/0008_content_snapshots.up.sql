CREATE TABLE content_snapshots (
  workspace_id text NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  snapshot_id text NOT NULL,
  scan_id text NOT NULL,
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[0-9a-f]{64}$'),
  metadata_digest text NOT NULL CHECK (metadata_digest ~ '^sha256:[0-9a-f]{64}$'),
  object_ref text NOT NULL CHECK (object_ref ~ '^snapshot://sha256/[0-9a-f]{64}$'),
  retrieval_metadata jsonb NOT NULL CHECK (jsonb_typeof(retrieval_metadata) = 'object'),
  parent_digests jsonb NOT NULL CHECK (jsonb_typeof(parent_digests) = 'array'),
  component_versions jsonb NOT NULL CHECK (jsonb_typeof(component_versions) = 'object'),
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retention_until timestamptz NOT NULL,
  content_deleted_at timestamptz,
  PRIMARY KEY (workspace_id, snapshot_id),
  UNIQUE (workspace_id, scan_id, content_digest, metadata_digest),
  FOREIGN KEY (workspace_id, scan_id) REFERENCES scans(workspace_id, scan_id) ON DELETE RESTRICT,
  CHECK (snapshot_id ~ '^snap_[0-9A-HJKMNP-TV-Z]{26}$')
);

CREATE INDEX content_snapshots_retention_idx
  ON content_snapshots (workspace_id, retention_until, snapshot_id) WHERE content_deleted_at IS NULL;

ALTER TABLE content_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON content_snapshots
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), ''))
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), ''));
