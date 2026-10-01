export const VERUS_SCHEMA_VERSION = "1.0" as const;

export const contractSchemaIds = Object.freeze({
  contextCapsule: "https://verus.security/contracts/v1/context-capsule.schema.json",
  ingestionRequest: "https://verus.security/contracts/v1/ingestion-request.schema.json",
  policyVerdict: "https://verus.security/contracts/v1/policy-verdict.schema.json",
  sourceRecord: "https://verus.security/contracts/v1/source-record.schema.json",
});

export type VerusSchemaVersion = typeof VERUS_SCHEMA_VERSION;
