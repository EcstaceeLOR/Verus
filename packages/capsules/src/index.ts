import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parseContextCapsule, type ContextCapsule } from "@verus/contracts";
import {
  canonicalizeJson,
  sha256Digest,
  verifyEd25519Signature,
  type PublicSigningKey,
} from "@verus/crypto";
import type { Ed25519SigningProvider } from "@verus/crypto";

type UnsignedCapsule = Omit<ContextCapsule, "signature">;

export interface CapsuleApproval {
  readonly policyApprovedClaimIds: readonly string[];
  readonly policyApprovedEvidenceIds: readonly string[];
}
export interface CapsuleSigningKey extends PublicSigningKey {
  readonly providerReference: string;
}
export interface CapsuleAuditEvent {
  readonly action: "capsule.created" | "capsule.verified" | "capsule.replayed";
  readonly capsuleId: string;
  readonly artifactDigest: string;
  readonly occurredAt: string;
  readonly details: Readonly<Record<string, string>>;
}
export interface CapsuleAuditSink {
  append(event: CapsuleAuditEvent): Promise<void>;
}
export interface CapsuleStore {
  put(capsule: ContextCapsule): Promise<void>;
  get(capsuleId: string): Promise<ContextCapsule | undefined>;
}

export class CapsuleIntegrityError extends Error {
  constructor(
    readonly code:
      | "CAPSULE_POLICY_DENIED"
      | "CAPSULE_SIGNATURE_INVALID"
      | "CAPSULE_KEY_UNAVAILABLE"
      | "CAPSULE_REPLAY_NONDETERMINISTIC",
    message: string,
  ) {
    super(message);
    this.name = "CapsuleIntegrityError";
  }
}

export async function buildCapsule(
  input: Readonly<{
    capsule: UnsignedCapsule;
    approval: CapsuleApproval;
    key: CapsuleSigningKey;
    signer: Ed25519SigningProvider;
    audit: CapsuleAuditSink;
  }>,
): Promise<Readonly<ContextCapsule>> {
  assertApproved(input.capsule, input.approval);
  const unsigned = canonicalizeJson(input.capsule);
  const artifactDigest = sha256Digest(unsigned);
  const signature = await input.signer.sign({
    purpose: "context_capsule",
    keyId: input.key.keyId,
    providerReference: input.key.providerReference,
    artifactDigest,
    canonicalBytes: unsigned,
  });
  const capsule = parseContextCapsule({
    ...input.capsule,
    signature: {
      algorithm: "Ed25519",
      key_id: input.key.keyId,
      signed_at: input.capsule.created_at,
      value: signature,
    },
  });
  await input.audit.append({
    action: "capsule.created",
    capsuleId: capsule.capsule_id,
    artifactDigest,
    occurredAt: capsule.created_at,
    details: { keyId: input.key.keyId, policyVersion: capsule.policy.version },
  });
  return capsule;
}

export async function verifyCapsule(
  input: Readonly<{
    capsule: ContextCapsule;
    keys: readonly PublicSigningKey[];
    audit?: CapsuleAuditSink;
  }>,
): Promise<Readonly<{ valid: true; artifactDigest: string }>> {
  const key = input.keys.find(
    (candidate) =>
      candidate.keyId === input.capsule.signature.key_id && candidate.algorithm === "Ed25519",
  );
  if (!key)
    throw new CapsuleIntegrityError(
      "CAPSULE_KEY_UNAVAILABLE",
      "Signing key is unavailable for offline verification.",
    );
  const unsigned = omitSignature(input.capsule);
  const bytes = canonicalizeJson(unsigned);
  if (!verifyEd25519Signature(bytes, input.capsule.signature.value, key.publicKey))
    throw new CapsuleIntegrityError(
      "CAPSULE_SIGNATURE_INVALID",
      "Context Capsule signature is invalid.",
    );
  const artifactDigest = sha256Digest(bytes);
  await input.audit?.append({
    action: "capsule.verified",
    capsuleId: input.capsule.capsule_id,
    artifactDigest,
    occurredAt: input.capsule.as_of,
    details: { keyId: key.keyId },
  });
  return Object.freeze({ valid: true, artifactDigest });
}

export async function replayCapsule<Result>(
  input: Readonly<{
    capsule: ContextCapsule;
    keys: readonly PublicSigningKey[];
    processor: (capsule: ContextCapsule) => Promise<Result>;
    audit?: CapsuleAuditSink;
    externalModelAvailable: boolean;
  }>,
): Promise<
  Readonly<{ result?: Result; reproducible: boolean; reason?: "EXTERNAL_MODEL_UNAVAILABLE" }>
> {
  await verifyCapsule(input);
  if (!input.externalModelAvailable)
    return Object.freeze({ reproducible: false, reason: "EXTERNAL_MODEL_UNAVAILABLE" });
  const result = await input.processor(input.capsule);
  const artifactDigest = sha256Digest(canonicalizeJson(omitSignature(input.capsule)));
  await input.audit?.append({
    action: "capsule.replayed",
    capsuleId: input.capsule.capsule_id,
    artifactDigest,
    occurredAt: input.capsule.as_of,
    details: { reproducible: "true" },
  });
  return Object.freeze({ result, reproducible: true });
}

export class FileSystemCapsuleStore implements CapsuleStore, CapsuleAuditSink {
  readonly #root: string;
  constructor(root: string) {
    this.#root = resolve(root);
  }
  async put(capsule: ContextCapsule): Promise<void> {
    const bytes = canonicalizeJson(capsule);
    const directory = join(this.#root, "capsules");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${capsule.capsule_id}.json`);
    try {
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    } catch (error) {
      const existing = await readFile(path);
      if (sha256Digest(existing) !== sha256Digest(bytes))
        throw new CapsuleIntegrityError(
          "CAPSULE_SIGNATURE_INVALID",
          "Capsule ID already refers to different content.",
        );
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  async get(capsuleId: string): Promise<ContextCapsule | undefined> {
    try {
      return parseContextCapsule(
        JSON.parse(
          await readFile(join(this.#root, "capsules", `${capsuleId}.json`), "utf8"),
        ) as unknown,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async append(event: CapsuleAuditEvent): Promise<void> {
    const directory = join(this.#root, "audit");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await appendFile(
      join(directory, "capsule-events.ndjson"),
      `${Buffer.from(canonicalizeJson(event)).toString("utf8")}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }
}

export { composeContextCapsule, type ProcessedFinding, type ProcessedScan } from "./composer.js";

function omitSignature(capsule: ContextCapsule): UnsignedCapsule {
  return Object.fromEntries(
    Object.entries(capsule).filter(([key]) => key !== "signature"),
  ) as UnsignedCapsule;
}
function assertApproved(capsule: UnsignedCapsule, approval: CapsuleApproval): void {
  const claims = new Set(approval.policyApprovedClaimIds);
  const evidence = new Set(approval.policyApprovedEvidenceIds);
  if (
    capsule.claims.some(
      (claim) => !claims.has(claim.claim_id) || claim.verification !== "verified",
    ) ||
    capsule.evidence.some(
      (item) =>
        !evidence.has(item.evidence_id) ||
        item.freshness !== "current" ||
        item.identity_state !== "verified",
    )
  )
    throw new CapsuleIntegrityError(
      "CAPSULE_POLICY_DENIED",
      "Capsule contains fields not approved by policy.",
    );
}
