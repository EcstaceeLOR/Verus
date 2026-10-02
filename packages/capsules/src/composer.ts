import type { ComponentVersion, ContextCapsule, Finding, PolicyReference } from "@verus/contracts";
import type { Ed25519SigningProvider } from "@verus/crypto";
import type { CapsuleApproval, CapsuleAuditSink, CapsuleSigningKey } from "./index.js";

export interface ProcessedFinding {
  readonly category: string;
  readonly confidenceBps: number | undefined;
  readonly detectorId: string;
  readonly findingId: string;
  readonly location: Readonly<Record<string, unknown>>;
  readonly reasonCode: string;
  readonly severity: Finding["severity"];
}

export interface ProcessedScan {
  readonly createdAt: Date;
  readonly inputDigest: ContextCapsule["input_digest"];
  readonly scanId: ContextCapsule["scan_id"];
  readonly state: "allowed" | "blocked" | "review";
  readonly workspaceId: ContextCapsule["workspace_id"];
}

function category(value: string, reasonCode: string): Finding["category"] {
  if (reasonCode === "DIRECT_INSTRUCTION_OVERRIDE") return "direct_prompt_injection";
  if (reasonCode === "INDIRECT_INSTRUCTION_OVERRIDE") return "indirect_prompt_injection";
  if (reasonCode === "SOURCE_IMPERSONATION") return "source_mismatch";
  if (value === "processing") return "policy_failure";
  return "other";
}

function location(value: Readonly<Record<string, unknown>>): Finding["location"] {
  const representation = value.representation;
  const permitted = ["raw", "canonical", "decoded", "metadata", "ocr"] as const;
  if (!permitted.includes(representation as (typeof permitted)[number]))
    return { representation: "metadata" };
  return {
    representation: representation as Finding["location"]["representation"],
    ...(typeof value.json_pointer === "string" ? { json_pointer: value.json_pointer } : {}),
    ...(typeof value.text_start === "number" ? { text_start: value.text_start } : {}),
    ...(typeof value.text_end === "number" ? { text_end: value.text_end } : {}),
  };
}

/** Builds a raw-content-free, signed wire capsule from an already completed deterministic scan. */
export async function composeContextCapsule(
  input: Readonly<{
    capsuleId: ContextCapsule["capsule_id"];
    scan: ProcessedScan;
    findings: readonly ProcessedFinding[];
    policy: PolicyReference;
    component: ComponentVersion;
    key: CapsuleSigningKey;
    signer: Ed25519SigningProvider;
    audit: CapsuleAuditSink;
    build: (
      input: Readonly<{
        capsule: Omit<ContextCapsule, "signature">;
        approval: CapsuleApproval;
        key: CapsuleSigningKey;
        signer: Ed25519SigningProvider;
        audit: CapsuleAuditSink;
      }>,
    ) => Promise<Readonly<ContextCapsule>>;
  }>,
): Promise<Readonly<ContextCapsule>> {
  const createdAt = input.scan.createdAt.toISOString();
  const findings = input.findings.map((item): Finding => ({
    finding_id: item.findingId as Finding["finding_id"],
    category: category(item.category, item.reasonCode),
    severity: item.severity,
    detector_id: item.detectorId,
    reason_code: item.reasonCode,
    ...(item.confidenceBps === undefined ? {} : { confidence_bps: item.confidenceBps }),
    location: location(item.location),
    extensions: {},
  }));
  const capsule: Omit<ContextCapsule, "signature"> = {
    schema_version: "1.0" as const,
    capsule_id: input.capsuleId,
    workspace_id: input.scan.workspaceId,
    scan_id: input.scan.scanId,
    input_digest: input.scan.inputDigest,
    created_at: createdAt,
    as_of: createdAt,
    subject: { kind: "unknown" as const, symbols: [] },
    claims: [],
    findings,
    evidence: [],
    conflicts: [],
    disposition:
      input.scan.state === "allowed"
        ? "allow"
        : input.scan.state === "blocked"
          ? "block"
          : "review",
    policy: input.policy,
    components: [input.component],
    extensions: {},
  };
  const approval: CapsuleApproval = {
    policyApprovedClaimIds: [],
    policyApprovedEvidenceIds: [],
  };
  return input.build({
    capsule,
    approval,
    key: input.key,
    signer: input.signer,
    audit: input.audit,
  });
}
