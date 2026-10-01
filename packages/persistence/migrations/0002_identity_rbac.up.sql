CREATE TABLE identities (
  identity_id text PRIMARY KEY,
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{1,63}$'),
  provider_subject_digest text NOT NULL
    CHECK (provider_subject_digest ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'deleted')),
  session_version bigint NOT NULL DEFAULT 0 CHECK (session_version >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (provider, provider_subject_digest),
  CHECK (identity_id ~ '^user_[0-9A-HJKMNP-TV-Z]{26}$')
);

CREATE TABLE memberships (
  workspace_id text NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  membership_id text NOT NULL,
  identity_id text NOT NULL REFERENCES identities(identity_id) ON DELETE RESTRICT,
  role text NOT NULL
    CHECK (role IN ('owner', 'admin', 'policy_manager', 'reviewer', 'analyst', 'auditor')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
  grant_version bigint NOT NULL DEFAULT 1 CHECK (grant_version > 0),
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, membership_id),
  UNIQUE (workspace_id, identity_id),
  CHECK (membership_id ~ '^member_[0-9A-HJKMNP-TV-Z]{26}$'),
  CHECK (status <> 'active' OR joined_at IS NOT NULL)
);

CREATE INDEX memberships_identity_workspace_idx
  ON memberships (identity_id, workspace_id) WHERE status <> 'removed';
CREATE INDEX memberships_workspace_status_role_idx
  ON memberships (workspace_id, status, role);

CREATE TABLE invitations (
  workspace_id text NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  invitation_id text NOT NULL,
  email_digest text NOT NULL CHECK (email_digest ~ '^sha256:[0-9a-f]{64}$'),
  token_digest text NOT NULL CHECK (token_digest ~ '^sha256:[0-9a-f]{64}$'),
  role text NOT NULL
    CHECK (role IN ('admin', 'policy_manager', 'reviewer', 'analyst', 'auditor')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by_membership_id text NOT NULL,
  accepted_by_identity_id text REFERENCES identities(identity_id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, invitation_id),
  UNIQUE (workspace_id, token_digest),
  FOREIGN KEY (workspace_id, invited_by_membership_id)
    REFERENCES memberships(workspace_id, membership_id) ON DELETE RESTRICT,
  CHECK (invitation_id ~ '^invite_[0-9A-HJKMNP-TV-Z]{26}$'),
  CHECK ((status = 'accepted') = (accepted_by_identity_id IS NOT NULL)),
  CHECK ((status = 'accepted') = (accepted_at IS NOT NULL))
);

CREATE UNIQUE INDEX invitations_pending_email_idx
  ON invitations (workspace_id, email_digest) WHERE status = 'pending';
CREATE INDEX invitations_workspace_expiry_idx
  ON invitations (workspace_id, status, expires_at);

CREATE TABLE service_accounts (
  workspace_id text NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  service_account_id text NOT NULL,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 128),
  role text NOT NULL
    CHECK (role IN ('ingestion_service', 'scan_worker', 'evidence_worker', 'integration_client', 'audit_exporter')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  grant_version bigint NOT NULL DEFAULT 1 CHECK (grant_version > 0),
  created_by_membership_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (workspace_id, service_account_id),
  FOREIGN KEY (workspace_id, created_by_membership_id)
    REFERENCES memberships(workspace_id, membership_id) ON DELETE RESTRICT,
  CHECK (service_account_id ~ '^svc_[0-9A-HJKMNP-TV-Z]{26}$'),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE INDEX service_accounts_workspace_status_idx
  ON service_accounts (workspace_id, status);

CREATE TABLE authorization_sessions (
  workspace_id text NOT NULL REFERENCES workspaces(workspace_id) ON DELETE RESTRICT,
  session_id text NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('human', 'service')),
  membership_id text,
  service_account_id text,
  grant_version bigint NOT NULL CHECK (grant_version > 0),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz,
  PRIMARY KEY (workspace_id, session_id),
  FOREIGN KEY (workspace_id, membership_id)
    REFERENCES memberships(workspace_id, membership_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, service_account_id)
    REFERENCES service_accounts(workspace_id, service_account_id) ON DELETE RESTRICT,
  CHECK (session_id ~ '^session_[0-9A-HJKMNP-TV-Z]{26}$'),
  CHECK (
    (subject_kind = 'human' AND membership_id IS NOT NULL AND service_account_id IS NULL)
    OR
    (subject_kind = 'service' AND membership_id IS NULL AND service_account_id IS NOT NULL)
  )
);

CREATE INDEX authorization_sessions_active_member_idx
  ON authorization_sessions (workspace_id, membership_id, expires_at)
  WHERE revoked_at IS NULL AND subject_kind = 'human';
CREATE INDEX authorization_sessions_active_service_idx
  ON authorization_sessions (workspace_id, service_account_id, expires_at)
  WHERE revoked_at IS NULL AND subject_kind = 'service';

CREATE FUNCTION verus_resolve_identity(
  requested_identity_id text,
  requested_provider text,
  requested_subject_digest text
) RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $verus$
  INSERT INTO public.identities (identity_id, provider, provider_subject_digest)
  VALUES (requested_identity_id, requested_provider, requested_subject_digest)
  ON CONFLICT (provider, provider_subject_digest)
  DO UPDATE SET updated_at = identities.updated_at
  RETURNING identity_id
$verus$;

REVOKE ALL ON FUNCTION verus_resolve_identity(text, text, text) FROM PUBLIC;

CREATE FUNCTION verus_membership_guard() RETURNS trigger
LANGUAGE plpgsql AS $verus$
BEGIN
  IF OLD.role = 'owner' AND OLD.status = 'active' AND TG_OP = 'DELETE' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.workspace_id, 0));
    IF NOT EXISTS (
      SELECT 1 FROM memberships
      WHERE workspace_id = OLD.workspace_id
        AND role = 'owner'
        AND status = 'active'
        AND membership_id <> OLD.membership_id
    ) THEN
      RAISE EXCEPTION 'workspace must retain an active owner' USING ERRCODE = '23000';
    END IF;
  END IF;
  IF OLD.role = 'owner' AND OLD.status = 'active' AND TG_OP = 'UPDATE'
     AND (NEW.role <> 'owner' OR NEW.status <> 'active') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.workspace_id, 0));
    IF NOT EXISTS (
      SELECT 1 FROM memberships
      WHERE workspace_id = OLD.workspace_id
        AND role = 'owner'
        AND status = 'active'
        AND membership_id <> OLD.membership_id
    ) THEN
      RAISE EXCEPTION 'workspace must retain an active owner' USING ERRCODE = '23000';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.role, NEW.status) IS DISTINCT FROM (OLD.role, OLD.status) THEN
    NEW.grant_version := OLD.grant_version + 1;
    NEW.updated_at := clock_timestamp();
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$verus$;

CREATE FUNCTION verus_service_account_guard() RETURNS trigger
LANGUAGE plpgsql AS $verus$
BEGIN
  IF (NEW.role, NEW.status) IS DISTINCT FROM (OLD.role, OLD.status) THEN
    NEW.grant_version := OLD.grant_version + 1;
    NEW.updated_at := clock_timestamp();
    NEW.revoked_at := CASE WHEN NEW.status = 'revoked' THEN clock_timestamp() ELSE NULL END;
  END IF;
  RETURN NEW;
END
$verus$;

CREATE FUNCTION verus_revoke_changed_grants() RETURNS trigger
LANGUAGE plpgsql AS $verus$
BEGIN
  IF TG_TABLE_NAME = 'memberships' THEN
    UPDATE authorization_sessions
      SET revoked_at = clock_timestamp(), revocation_reason = 'grant_changed'
      WHERE workspace_id = NEW.workspace_id
        AND membership_id = NEW.membership_id
        AND revoked_at IS NULL;
  ELSE
    UPDATE authorization_sessions
      SET revoked_at = clock_timestamp(), revocation_reason = 'grant_changed'
      WHERE workspace_id = NEW.workspace_id
        AND service_account_id = NEW.service_account_id
        AND revoked_at IS NULL;
  END IF;
  RETURN NULL;
END
$verus$;

CREATE TRIGGER memberships_guard_update
  BEFORE UPDATE OF role, status ON memberships
  FOR EACH ROW EXECUTE FUNCTION verus_membership_guard();
CREATE TRIGGER memberships_guard_delete
  BEFORE DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION verus_membership_guard();
CREATE TRIGGER memberships_revoke_changed_grants
  AFTER UPDATE OF role, status ON memberships
  FOR EACH ROW
  WHEN ((NEW.role, NEW.status) IS DISTINCT FROM (OLD.role, OLD.status))
  EXECUTE FUNCTION verus_revoke_changed_grants();
CREATE TRIGGER service_accounts_guard
  BEFORE UPDATE OF role, status ON service_accounts
  FOR EACH ROW EXECUTE FUNCTION verus_service_account_guard();
CREATE TRIGGER service_accounts_revoke_changed_grants
  AFTER UPDATE OF role, status ON service_accounts
  FOR EACH ROW
  WHEN ((NEW.role, NEW.status) IS DISTINCT FROM (OLD.role, OLD.status))
  EXECUTE FUNCTION verus_revoke_changed_grants();

ALTER TABLE identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY identity_workspace_read ON identities FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.identity_id = identities.identity_id
      AND memberships.workspace_id = nullif(current_setting('app.workspace_id', true), '')
      AND memberships.status <> 'removed'
  )
);

DO $verus$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'memberships', 'invitations', 'service_accounts', 'authorization_sessions'
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
