CREATE TABLE api_keys (
  workspace_id text NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  key_id text NOT NULL,
  service_account_id text NOT NULL,
  prefix text NOT NULL CHECK (length(prefix) BETWEEN 12 AND 32),
  verifier text NOT NULL CHECK (verifier ~ '^hmac-sha256:[0-9a-f]{64}$'),
  verifier_version integer NOT NULL CHECK (verifier_version > 0),
  scopes text[] NOT NULL CHECK (
    cardinality(scopes) BETWEEN 1 AND 32
    AND scopes <@ ARRAY[
      'workspace.read', 'workspace.update', 'workspace.delete', 'membership.read',
      'membership.invite', 'membership.manage', 'service_account.manage', 'scan.create',
      'scan.read', 'scan.process', 'finding.read', 'finding.write', 'evidence.read',
      'evidence.write', 'review.resolve', 'policy.read', 'policy.write', 'policy.promote',
      'capsule.read', 'audit.read', 'audit.export', 'integration.manage', 'key.manage'
    ]::text[]
  ),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'retiring', 'revoked', 'expired')),
  created_by_membership_id text NOT NULL,
  rotated_from_key_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (workspace_id, key_id),
  UNIQUE (workspace_id, prefix),
  FOREIGN KEY (workspace_id, service_account_id)
    REFERENCES service_accounts(workspace_id, service_account_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, created_by_membership_id)
    REFERENCES memberships(workspace_id, membership_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, rotated_from_key_id)
    REFERENCES api_keys(workspace_id, key_id) ON DELETE RESTRICT,
  CHECK (key_id ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$'),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE INDEX api_keys_service_status_idx
  ON api_keys (workspace_id, service_account_id, status);
CREATE INDEX api_keys_expiry_idx
  ON api_keys (workspace_id, expires_at) WHERE status IN ('active', 'retiring');

CREATE TABLE secret_metadata (
  workspace_id text NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  secret_id text NOT NULL,
  purpose text NOT NULL,
  provider_ref text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'retiring', 'revoked', 'destroyed')),
  created_by_membership_id text NOT NULL,
  replaced_by_secret_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  destroyed_at timestamptz,
  PRIMARY KEY (workspace_id, secret_id),
  UNIQUE (workspace_id, provider_ref),
  FOREIGN KEY (workspace_id, created_by_membership_id)
    REFERENCES memberships(workspace_id, membership_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, replaced_by_secret_id)
    REFERENCES secret_metadata(workspace_id, secret_id) ON DELETE RESTRICT,
  CHECK (secret_id ~ '^secret_[0-9A-HJKMNP-TV-Z]{26}$'),
  CHECK (purpose ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CHECK ((status = 'destroyed') = (destroyed_at IS NOT NULL))
);

CREATE UNIQUE INDEX secret_metadata_one_active_purpose_idx
  ON secret_metadata (workspace_id, purpose) WHERE status = 'active';

ALTER TABLE key_metadata
  ADD COLUMN public_key text,
  ADD COLUMN not_before timestamptz,
  ADD COLUMN sign_until timestamptz,
  ADD COLUMN verify_until timestamptz,
  ADD COLUMN replaced_by_key_id text,
  ADD CONSTRAINT key_metadata_replacement_fk
    FOREIGN KEY (workspace_id, replaced_by_key_id)
    REFERENCES key_metadata(workspace_id, key_id) ON DELETE RESTRICT,
  ADD CONSTRAINT key_metadata_public_key_format
    CHECK (public_key IS NULL OR public_key ~ '^[A-Za-z0-9_-]{59}$'),
  ADD CONSTRAINT key_metadata_validity_window
    CHECK (
      (not_before IS NULL OR sign_until IS NULL OR not_before < sign_until)
      AND (sign_until IS NULL OR verify_until IS NULL OR sign_until <= verify_until)
    );

CREATE UNIQUE INDEX key_metadata_one_active_signer_idx
  ON key_metadata (workspace_id, purpose)
  WHERE purpose = 'capsule_signing' AND status = 'active';

DO $verus$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['api_keys', 'secret_metadata']
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
