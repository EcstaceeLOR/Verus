CREATE TABLE workspaces (
  workspace_id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleting')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (workspace_id ~ '^ws_[0-9A-HJKMNP-TV-Z]{26}$'),
  CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$')
);

CREATE TABLE scans (
  workspace_id text NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  scan_id text NOT NULL,
  request_id text NOT NULL,
  input_digest text NOT NULL,
  state text NOT NULL DEFAULT 'accepted'
    CHECK (state IN ('accepted', 'queued', 'processing', 'review', 'allowed', 'blocked', 'failed', 'cancelled')),
  state_version bigint NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  policy_id text,
  policy_version integer,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (workspace_id, scan_id),
  UNIQUE (workspace_id, request_id),
  CHECK (scan_id ~ '^scan_[0-9A-HJKMNP-TV-Z]{26}$'),
  CHECK (request_id ~ '^req_[0-9A-HJKMNP-TV-Z]{26}$'),
  CHECK (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  CHECK ((policy_id IS NULL) = (policy_version IS NULL))
);

CREATE INDEX scans_workspace_state_created_idx
  ON scans (workspace_id, state, created_at DESC);

CREATE TABLE policies (
  workspace_id text NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  policy_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  lifecycle text NOT NULL CHECK (lifecycle IN ('draft', 'active', 'retired')),
  digest text NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  promoted_at timestamptz,
  PRIMARY KEY (workspace_id, policy_id, version),
  UNIQUE (workspace_id, digest),
  CHECK (policy_id ~ '^policy_[0-9A-HJKMNP-TV-Z]{26}$')
);

CREATE UNIQUE INDEX policies_one_active_version_idx
  ON policies (workspace_id, policy_id) WHERE lifecycle = 'active';

ALTER TABLE scans ADD CONSTRAINT scans_policy_version_fk
  FOREIGN KEY (workspace_id, policy_id, policy_version)
  REFERENCES policies (workspace_id, policy_id, version) ON DELETE RESTRICT;

CREATE TABLE findings (
  workspace_id text NOT NULL,
  finding_id text NOT NULL,
  scan_id text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  detector_id text NOT NULL,
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  confidence_bps integer CHECK (confidence_bps BETWEEN 0 AND 10000),
  location jsonb NOT NULL CHECK (jsonb_typeof(location) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, finding_id),
  FOREIGN KEY (workspace_id, scan_id) REFERENCES scans(workspace_id, scan_id) ON DELETE CASCADE
);

CREATE INDEX findings_workspace_scan_severity_idx
  ON findings (workspace_id, scan_id, severity);

CREATE TABLE evidence_records (
  workspace_id text NOT NULL,
  evidence_id text NOT NULL,
  scan_id text NOT NULL,
  source_id text NOT NULL,
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  identity_state text NOT NULL CHECK (identity_state IN ('verified', 'mismatched', 'unknown')),
  source_class text,
  source_tier text,
  quality_grade text,
  canonical_url text,
  published_at timestamptz,
  retrieved_at timestamptz NOT NULL,
  freshness text NOT NULL CHECK (freshness IN ('current', 'stale', 'superseded', 'unknown')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, evidence_id),
  FOREIGN KEY (workspace_id, scan_id) REFERENCES scans(workspace_id, scan_id) ON DELETE CASCADE
);

CREATE INDEX evidence_workspace_scan_source_idx
  ON evidence_records (workspace_id, scan_id, source_id);

CREATE TABLE jobs (
  workspace_id text NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  job_id text NOT NULL,
  kind text NOT NULL,
  state text NOT NULL DEFAULT 'available'
    CHECK (state IN ('available', 'leased', 'succeeded', 'retry_wait', 'dead_lettered', 'cancelled')),
  payload_ref text NOT NULL,
  idempotency_key text NOT NULL,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, job_id),
  UNIQUE (workspace_id, kind, idempotency_key),
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL))
);

CREATE INDEX jobs_workspace_claim_idx
  ON jobs (workspace_id, state, available_at, created_at)
  WHERE state IN ('available', 'retry_wait');
CREATE INDEX jobs_workspace_state_idx ON jobs (workspace_id, state, updated_at DESC);

CREATE TABLE key_metadata (
  workspace_id text NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  key_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('api', 'capsule_signing', 'webhook_signing')),
  provider_ref text NOT NULL,
  algorithm text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'active', 'retiring', 'revoked', 'destroyed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  activated_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (workspace_id, key_id),
  UNIQUE (workspace_id, provider_ref)
);

CREATE TABLE audit_events (
  workspace_id text NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  event_id text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'api_key', 'service', 'system')),
  actor_id text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  reason_code text,
  previous_state jsonb,
  new_state jsonb,
  occurred_at timestamptz NOT NULL,
  correlation_id text,
  PRIMARY KEY (workspace_id, event_id)
);

CREATE INDEX audit_workspace_time_idx ON audit_events (workspace_id, occurred_at DESC, event_id);
CREATE INDEX audit_workspace_target_idx ON audit_events (workspace_id, target_type, target_id);

CREATE FUNCTION verus_prevent_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $verus$
BEGIN
  RAISE EXCEPTION 'audit events are append-only' USING ERRCODE = '55000';
END
$verus$;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION verus_prevent_audit_mutation();

CREATE TABLE outbox_events (
  workspace_id text NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  event_id text NOT NULL,
  topic text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  PRIMARY KEY (workspace_id, event_id)
);

CREATE INDEX outbox_unpublished_idx
  ON outbox_events (workspace_id, created_at, event_id) WHERE published_at IS NULL;

DO $verus$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'workspaces', 'scans', 'policies', 'findings', 'evidence_records',
    'jobs', 'key_metadata', 'audit_events', 'outbox_events'
  ]
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
