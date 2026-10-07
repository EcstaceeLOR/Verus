CREATE FUNCTION verus_workspaces_for_identity(
  requested_provider text,
  requested_subject_digest text
) RETURNS TABLE (
  workspace_id text,
  membership_id text,
  role text,
  membership_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $verus$
  SELECT m.workspace_id, m.membership_id, m.role, m.status
  FROM public.identities i
  JOIN public.memberships m ON m.identity_id = i.identity_id
  WHERE i.provider = requested_provider
    AND i.provider_subject_digest = requested_subject_digest
    AND i.status = 'active'
    AND m.status <> 'removed'
  ORDER BY m.created_at, m.workspace_id
$verus$;

REVOKE ALL ON FUNCTION verus_workspaces_for_identity(text, text) FROM PUBLIC;
