DROP INDEX IF EXISTS key_metadata_one_active_signer_idx;
ALTER TABLE key_metadata
  DROP CONSTRAINT IF EXISTS key_metadata_validity_window,
  DROP CONSTRAINT IF EXISTS key_metadata_public_key_format,
  DROP CONSTRAINT IF EXISTS key_metadata_replacement_fk,
  DROP COLUMN IF EXISTS replaced_by_key_id,
  DROP COLUMN IF EXISTS verify_until,
  DROP COLUMN IF EXISTS sign_until,
  DROP COLUMN IF EXISTS not_before,
  DROP COLUMN IF EXISTS public_key;
DROP TABLE IF EXISTS secret_metadata;
DROP TABLE IF EXISTS api_keys;
