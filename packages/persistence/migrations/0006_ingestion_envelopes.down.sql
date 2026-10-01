DROP TABLE IF EXISTS ingestion_envelopes;

ALTER TABLE scans
  DROP CONSTRAINT IF EXISTS scans_workspace_idempotency_key_unique,
  DROP CONSTRAINT IF EXISTS scans_request_digest_format,
  DROP CONSTRAINT IF EXISTS scans_idempotency_key_format,
  DROP COLUMN IF EXISTS request_digest,
  DROP COLUMN IF EXISTS idempotency_key;
