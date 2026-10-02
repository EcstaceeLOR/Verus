export type DataAsset =
  | "account_identity"
  | "api_key_verifiers"
  | "audit_events"
  | "context_capsules_verdicts"
  | "derived_claims_findings"
  | "normalized_content"
  | "operational_telemetry"
  | "portfolio_data"
  | "public_source_metadata"
  | "quarantined_content"
  | "raw_untrusted_content"
  | "recoverable_credentials";
type DataClass = "confidential" | "internal" | "public" | "restricted" | "secret";
interface RetentionRule {
  readonly backupExpiryDays: number;
  readonly defaultDays: number;
  readonly legalHoldAllowed: boolean;
  readonly maximumDays: number;
  readonly classification: DataClass;
}
const RULES: Readonly<Record<DataAsset, RetentionRule>> = Object.freeze({
  account_identity: {
    backupExpiryDays: 35,
    defaultDays: 30,
    legalHoldAllowed: true,
    maximumDays: 90,
    classification: "restricted",
  },
  api_key_verifiers: {
    backupExpiryDays: 35,
    defaultDays: 30,
    legalHoldAllowed: false,
    maximumDays: 90,
    classification: "secret",
  },
  audit_events: {
    backupExpiryDays: 35,
    defaultDays: 365,
    legalHoldAllowed: true,
    maximumDays: 2555,
    classification: "confidential",
  },
  context_capsules_verdicts: {
    backupExpiryDays: 35,
    defaultDays: 365,
    legalHoldAllowed: true,
    maximumDays: 2555,
    classification: "confidential",
  },
  derived_claims_findings: {
    backupExpiryDays: 35,
    defaultDays: 30,
    legalHoldAllowed: true,
    maximumDays: 365,
    classification: "confidential",
  },
  normalized_content: {
    backupExpiryDays: 35,
    defaultDays: 7,
    legalHoldAllowed: true,
    maximumDays: 30,
    classification: "confidential",
  },
  operational_telemetry: {
    backupExpiryDays: 35,
    defaultDays: 30,
    legalHoldAllowed: false,
    maximumDays: 90,
    classification: "internal",
  },
  portfolio_data: {
    backupExpiryDays: 35,
    defaultDays: 1,
    legalHoldAllowed: true,
    maximumDays: 7,
    classification: "restricted",
  },
  public_source_metadata: {
    backupExpiryDays: 35,
    defaultDays: 365,
    legalHoldAllowed: true,
    maximumDays: 2555,
    classification: "public",
  },
  quarantined_content: {
    backupExpiryDays: 35,
    defaultDays: 30,
    legalHoldAllowed: true,
    maximumDays: 90,
    classification: "restricted",
  },
  raw_untrusted_content: {
    backupExpiryDays: 35,
    defaultDays: 7,
    legalHoldAllowed: true,
    maximumDays: 30,
    classification: "confidential",
  },
  recoverable_credentials: {
    backupExpiryDays: 35,
    defaultDays: 0,
    legalHoldAllowed: false,
    maximumDays: 0,
    classification: "secret",
  },
});
export interface LegalHold {
  readonly asset: DataAsset;
  readonly authority: string;
  readonly reviewAt: Date;
  readonly status: "active" | "released";
}
function validDate(value: Date): void {
  if (Number.isNaN(value.getTime())) throw new TypeError("Invalid lifecycle date.");
}
function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}
/** Calculates bounded retention and backup-expiry dates without accepting arbitrary policies. */
export function scheduleRetention(
  asset: DataAsset,
  createdAt: Date,
  requestedDays?: number,
): Readonly<{ backupExpiresAt: Date; retentionUntil: Date }> {
  validDate(createdAt);
  const rule = RULES[asset];
  const days = requestedDays ?? rule.defaultDays;
  if (!Number.isSafeInteger(days) || days < 0 || days > rule.maximumDays)
    throw new RangeError("Retention duration exceeds the asset policy.");
  return Object.freeze({
    retentionUntil: addDays(createdAt, days),
    backupExpiresAt: addDays(createdAt, days + rule.backupExpiryDays),
  });
}
export function createLegalHold(asset: DataAsset, authority: string, reviewAt: Date): LegalHold {
  if (!RULES[asset].legalHoldAllowed)
    throw new TypeError("This asset class cannot be retained by legal hold.");
  if (!/^[A-Z][A-Z0-9_-]{2,63}$/.test(authority))
    throw new TypeError("Legal-hold authority must be a stable code.");
  validDate(reviewAt);
  return Object.freeze({ asset, authority, reviewAt: new Date(reviewAt), status: "active" });
}
/** Returns a tombstone-first purge plan; callers reconcile every listed store before completion. */
export function planDeletion(
  input: Readonly<{ asset: DataAsset; hold?: LegalHold; now: Date; retentionUntil: Date }>,
): Readonly<{
  allowed: boolean;
  reason?: "legal_hold" | "retention_not_due";
  targets?: readonly string[];
}> {
  validDate(input.now);
  validDate(input.retentionUntil);
  if (input.hold?.status === "active")
    return Object.freeze({ allowed: false, reason: "legal_hold" });
  if (input.now < input.retentionUntil)
    return Object.freeze({ allowed: false, reason: "retention_not_due" });
  return Object.freeze({
    allowed: true,
    targets: Object.freeze(["primary_store", "object_store", "queue", "cache", "search_index"]),
  });
}
/** Secrets never go to a model provider; restricted/confidential data requires explicit consent. */
export function mayForwardToModel(asset: DataAsset, consentActive: boolean): boolean {
  const classification = RULES[asset].classification;
  return (
    classification !== "secret" &&
    (["public", "internal"].includes(classification) || consentActive)
  );
}
