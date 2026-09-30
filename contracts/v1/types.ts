/**
 * Verus v1 wire contracts.
 *
 * JSON Schema is authoritative at runtime. These types intentionally model the
 * serialized representation: decimals, digests, timestamps, and signatures
 * remain strings so that consumers cannot silently lose precision.
 */

export type SchemaVersion = "1.0";
export type Timestamp = string;
export type Sha256Digest = `sha256:${string}`;
export type VerusId = `${string}_${string}`;
export type BasisPoints = number;
export type Extensions = Readonly<Record<string, unknown>>;

export interface Subject {
  readonly kind:
    | "equity"
    | "etf"
    | "rtoken"
    | "stock_perpetual"
    | "market"
    | "unknown";
  readonly symbols: readonly string[];
  readonly entity_ids?: readonly string[];
}

export interface CitationLocator {
  readonly page?: number;
  readonly section?: string;
  readonly json_pointer?: string;
  readonly text_start?: number;
  readonly text_end?: number;
}

export interface Citation {
  readonly source_id: VerusId;
  readonly snapshot_digest: Sha256Digest;
  readonly locator: CitationLocator;
  readonly excerpt_digest?: Sha256Digest;
}

export interface DecimalValue {
  readonly decimal: string;
  readonly unit?: string;
  readonly currency?: string;
}

export type ClaimValue = string | boolean | DecimalValue;

export interface Claim {
  readonly claim_id: VerusId;
  readonly kind:
    | "financial_metric"
    | "guidance"
    | "corporate_action"
    | "market_event"
    | "product_announcement"
    | "other";
  readonly statement: string;
  readonly value: ClaimValue;
  readonly period?: string;
  readonly verification:
    | "verified"
    | "contradicted"
    | "unsupported"
    | "ambiguous"
    | "pending";
  readonly confidence_bps: BasisPoints;
  readonly citations: readonly Citation[];
  readonly extensions?: Extensions;
}

export interface FindingLocation {
  readonly representation: "raw" | "canonical" | "decoded" | "metadata" | "ocr";
  readonly json_pointer?: string;
  readonly text_start?: number;
  readonly text_end?: number;
}

export interface Finding {
  readonly finding_id: VerusId;
  readonly category:
    | "direct_prompt_injection"
    | "indirect_prompt_injection"
    | "obfuscation"
    | "hidden_content"
    | "source_mismatch"
    | "stale_evidence"
    | "contradiction"
    | "parser_risk"
    | "policy_failure"
    | "other";
  readonly severity: "info" | "low" | "medium" | "high" | "critical";
  readonly detector_id: string;
  readonly reason_code: string;
  readonly confidence_bps?: BasisPoints;
  readonly location: FindingLocation;
  readonly extensions?: Extensions;
}

export interface Evidence {
  readonly evidence_id: VerusId;
  readonly source_id: VerusId;
  readonly snapshot_digest: Sha256Digest;
  readonly identity_state: "verified" | "mismatched" | "unknown";
  readonly published_at?: Timestamp;
  readonly retrieved_at: Timestamp;
  readonly freshness: "current" | "stale" | "superseded" | "unknown";
  readonly canonical_url?: string;
  readonly extensions?: Extensions;
}

export interface Conflict {
  readonly conflict_id: VerusId;
  readonly claim_ids: readonly VerusId[];
  readonly status: "unresolved" | "resolved" | "superseded";
  readonly resolution?: string;
}

export interface PolicyReference {
  readonly policy_id: VerusId;
  readonly version: string;
  readonly digest: Sha256Digest;
}

export interface ComponentVersion {
  readonly component: string;
  readonly version: string;
  readonly digest: Sha256Digest;
}

export interface CapsuleSignature {
  readonly algorithm: "Ed25519";
  readonly key_id: VerusId;
  readonly signed_at: Timestamp;
  readonly value: string;
}

export interface ContextCapsule {
  readonly schema_version: SchemaVersion;
  readonly capsule_id: VerusId;
  readonly workspace_id: VerusId;
  readonly scan_id: VerusId;
  readonly input_digest: Sha256Digest;
  readonly created_at: Timestamp;
  readonly as_of: Timestamp;
  readonly subject: Subject;
  readonly claims: readonly Claim[];
  readonly findings: readonly Finding[];
  readonly evidence: readonly Evidence[];
  readonly conflicts: readonly Conflict[];
  readonly disposition: "allow" | "review" | "block";
  readonly policy: PolicyReference;
  readonly components: readonly ComponentVersion[];
  readonly extensions: Extensions;
  readonly signature: CapsuleSignature;
}

export type IngestionInput =
  | Readonly<{ kind: "url"; url: string }>
  | Readonly<{
      kind: "text";
      text: string;
      media_type: "text/plain" | "text/html" | "application/xml" | "application/json";
    }>
  | Readonly<{
      kind: "upload";
      upload_id: VerusId;
      media_type: string;
      size_bytes: number;
      digest: Sha256Digest;
    }>
  | Readonly<{
      kind: "feed_event";
      source_id: VerusId;
      event_id: string;
      payload_digest: Sha256Digest;
    }>;

export interface IngestionRequest {
  readonly schema_version: SchemaVersion;
  readonly request_id: VerusId;
  readonly workspace_id: VerusId;
  readonly submitted_at: Timestamp;
  readonly input: IngestionInput;
  readonly extensions: Extensions;
}

export interface SourceRecord {
  readonly schema_version: SchemaVersion;
  readonly source_id: VerusId;
  readonly kind: "regulator" | "issuer" | "exchange" | "news" | "user" | "unknown";
  readonly display_name: string;
  readonly identity_state: "verified" | "mismatched" | "unknown";
  readonly canonical_origins: readonly string[];
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
  readonly extensions: Extensions;
}

export interface PolicyVerdict {
  readonly schema_version: SchemaVersion;
  readonly verdict_id: VerusId;
  readonly scan_id: VerusId;
  readonly evaluated_at: Timestamp;
  readonly disposition: "allow" | "review" | "block";
  readonly policy: PolicyReference;
  readonly finding_ids: readonly VerusId[];
  readonly reason_codes: readonly string[];
  readonly extensions: Extensions;
}

export type VerusContract = ContextCapsule | IngestionRequest | SourceRecord | PolicyVerdict;
