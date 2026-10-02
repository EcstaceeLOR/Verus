CREATE TABLE context_capsules (
  workspace_id text NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  capsule_id text NOT NULL,
  scan_id text NOT NULL,
  capsule_digest text NOT NULL CHECK (capsule_digest ~ '^sha256:[0-9a-f]{64}$'),
  signing_key_id text NOT NULL,
  capsule jsonb NOT NULL CHECK (jsonb_typeof(capsule) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, capsule_id),
  UNIQUE (workspace_id, scan_id),
  FOREIGN KEY (workspace_id, scan_id) REFERENCES scans(workspace_id, scan_id) ON DELETE RESTRICT,
  CHECK (capsule_id ~ '^cap_[0-9A-HJKMNP-TV-Z]{26}$'),
  CHECK (signing_key_id ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
);

CREATE INDEX context_capsules_workspace_created_idx
  ON context_capsules (workspace_id, created_at DESC, capsule_id);

ALTER TABLE context_capsules ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_capsules FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON context_capsules
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), ''))
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), ''));
