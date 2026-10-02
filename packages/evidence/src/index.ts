export interface SourceRecord {
  readonly id: string;
  readonly version: string;
  readonly publisher: string;
  readonly domains: readonly string[];
  readonly aliases: readonly string[];
  readonly publicKeyFingerprints: readonly string[];
  readonly reviewState: "approved" | "revoked";
}
export * from "./sec.js";
export interface SourceObservation {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly redirectUrls: readonly string[];
  readonly tlsVerified: boolean;
  readonly publisherMetadata?: string;
}
export interface SourceVerification {
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly disposition: "verified" | "mismatch" | "unknown";
  readonly reasons: readonly string[];
  readonly observation: SourceObservation;
}
const host = (value: string) => new URL(value).hostname.toLowerCase();
export function verifySource(
  record: SourceRecord | undefined,
  observation: SourceObservation,
): Readonly<SourceVerification> {
  if (!record)
    return Object.freeze({
      sourceId: "unknown",
      sourceVersion: "unknown",
      disposition: "unknown",
      reasons: Object.freeze(["SOURCE_NOT_REGISTERED"]),
      observation,
    });
  const reasons: string[] = [];
  if (record.reviewState !== "approved") reasons.push("SOURCE_REVOKED");
  if (!observation.tlsVerified) reasons.push("TLS_UNVERIFIED");
  if (!record.domains.includes(host(observation.finalUrl))) reasons.push("FINAL_DOMAIN_MISMATCH");
  if (observation.redirectUrls.some((url) => !record.domains.includes(host(url))))
    reasons.push("REDIRECT_DOMAIN_MISMATCH");
  if (
    observation.publisherMetadata &&
    observation.publisherMetadata !== record.publisher &&
    !record.aliases.includes(observation.publisherMetadata)
  )
    reasons.push("PUBLISHER_METADATA_MISMATCH");
  return Object.freeze({
    sourceId: record.id,
    sourceVersion: record.version,
    disposition: reasons.length ? "mismatch" : "verified",
    reasons: Object.freeze(reasons.sort()),
    observation,
  });
}
