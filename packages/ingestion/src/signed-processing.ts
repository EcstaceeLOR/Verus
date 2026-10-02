import { randomBytes } from "node:crypto";

import { buildCapsule, composeContextCapsule } from "@verus/capsules";
import type {
  type CapsuleAuditSink,
  type CapsuleSigningKey,
  type ProcessedFinding,
  type ProcessedScan as CapsuleProcessedScan,
} from "@verus/capsules";
import { canonicalizeJson, sha256Digest } from "@verus/crypto";
import type { Ed25519SigningProvider } from "@verus/crypto";
import { withWorkspaceTransaction, workspaceId } from "@verus/persistence";
import type { Pool } from "pg";

import type { ScanProcessingService } from "./processing.js";

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const componentDigest = sha256Digest(new TextEncoder().encode("verus-processing/1"));

function id(prefix: "cap" | "event"): string {
  const entropy = randomBytes(26);
  return `${prefix}_${[...entropy].map((byte) => alphabet[byte & 31]).join("")}`;
}

/** Processes a queued scan then atomically signs, audits, and persists its Context Capsule. */
export class SignedScanProcessingService {
  constructor(
    private readonly processing: ScanProcessingService,
    private readonly pool: Pool,
    private readonly signer: Ed25519SigningProvider,
    private readonly policyId: string,
  ) {}

  async process(
    input: Readonly<{ workspaceId: string; scanId: string }>,
  ): Promise<Readonly<{ capsuleDigest: string }>> {
    const tenant = workspaceId(input.workspaceId);
    const existing = await withWorkspaceTransaction(
      this.pool,
      tenant,
      (store) => store.getContextCapsule(input.scanId),
      { isolation: "read committed", operationName: "scan.capsule.lookup" },
    );
    if (existing !== undefined)
      return Object.freeze({ capsuleDigest: sha256Digest(canonicalizeJson(existing)) });

    const processed = await this.processing.process(input.workspaceId, input.scanId);
    return withWorkspaceTransaction(
      this.pool,
      tenant,
      async (store) => {
        const replay = await store.getContextCapsule(input.scanId);
        if (replay !== undefined)
          return Object.freeze({ capsuleDigest: sha256Digest(canonicalizeJson(replay)) });
        const [policy, key, findings] = await Promise.all([
          store.getActivePolicy(this.policyId),
          store.credentials().getActiveSigningKey(new Date()),
          store.listFindings(input.scanId),
        ]);
        if (policy === undefined) throw new Error("No active configured policy is available.");
        if (key === undefined) throw new Error("No active capsule signing key is available.");
        const audit: CapsuleAuditSink = {
          append: async (event) =>
            store.appendAuditEvent({
              eventId: id("event"),
              actorType: "system",
              actorId: "verus-worker",
              action: event.action,
              targetType: "context_capsule",
              targetId: event.capsuleId,
              occurredAt: new Date(event.occurredAt),
              newState: { artifact_digest: event.artifactDigest, ...event.details },
            }),
        };
        const capsule = await composeContextCapsule({
          capsuleId: id("cap") as `${string}_${string}`,
          scan: processed.scan as unknown as CapsuleProcessedScan,
          findings: findings as unknown as readonly ProcessedFinding[],
          policy: {
            policy_id: policy.policyId as `policy_${string}`,
            version: String(policy.version),
            digest: policy.digest as `sha256:${string}`,
          },
          component: { component: "verus-processing", version: "1", digest: componentDigest },
          key: key as CapsuleSigningKey,
          signer: this.signer,
          audit,
          build: buildCapsule,
        });
        await store.storeContextCapsule(capsule);
        return Object.freeze({ capsuleDigest: sha256Digest(canonicalizeJson(capsule)) });
      },
      { isolation: "serializable", operationName: "scan.capsule.persist" },
    );
  }
}
