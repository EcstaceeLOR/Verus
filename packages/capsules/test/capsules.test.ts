import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseContextCapsule, type ContextCapsule } from "@verus/contracts";
import {
  Ed25519SigningProvider,
  SealedFileSecretProvider,
  SecretValue,
  generateEd25519Key,
} from "@verus/crypto";
import {
  buildCapsule,
  composeContextCapsule,
  FileSystemCapsuleStore,
  replayCapsule,
  verifyCapsule,
} from "../src/index.js";
import fixture from "../../../contracts/v1/fixtures/valid/context-capsule.json" with { type: "json" };

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "verus-capsule-"));
  roots.push(root);
  const master = new SecretValue(randomBytes(32));
  const secrets = new SealedFileSecretProvider(join(root, "keys"), master);
  const key = await generateEd25519Key(
    "key_01ARZ3NDEKTSV4RRFFQ69G5FB5",
    "signing/capsule",
    secrets,
  );
  return {
    master,
    secrets,
    key: { ...key, providerReference: "signing/capsule" },
    signer: new Ed25519SigningProvider(secrets),
    store: new FileSystemCapsuleStore(root),
  };
}
function unsignedFixture(): Omit<ContextCapsule, "signature"> {
  const capsule = parseContextCapsule(fixture);
  return Object.fromEntries(Object.entries(capsule).filter(([key]) => key !== "signature")) as Omit<
    ContextCapsule,
    "signature"
  >;
}
describe("Context Capsules", () => {
  it("composes a signed, raw-content-free capsule from a completed scan", async () => {
    const setupResult = await setup();
    try {
      const capsule = await composeContextCapsule({
        capsuleId: "cap_01ARZ3NDEKTSV4RRFFQ69G5FB5",
        scan: {
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          inputDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          scanId: "scan_01ARZ3NDEKTSV4RRFFQ69G5FB5",
          state: "blocked",
          workspaceId: "ws_01ARZ3NDEKTSV4RRFFQ69G5FB5",
        },
        findings: [
          {
            category: "prompt_injection",
            confidenceBps: 9800,
            detectorId: "detector.rules.v1",
            findingId: "finding_01ARZ3NDEKTSV4RRFFQ69G5FB5",
            location: { representation: "raw", text_start: 0, text_end: 12 },
            reasonCode: "DIRECT_INSTRUCTION_OVERRIDE",
            severity: "critical",
          },
        ],
        policy: {
          policy_id: "policy_01ARZ3NDEKTSV4RRFFQ69G5FB5",
          version: "1.0.0",
          digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        component: {
          component: "verus-processing",
          version: "1.0.0",
          digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        },
        key: setupResult.key,
        signer: setupResult.signer,
        audit: setupResult.store,
        build: buildCapsule,
      });
      expect(capsule.disposition).toBe("block");
      expect(capsule.findings[0]).toMatchObject({ category: "direct_prompt_injection" });
      expect(capsule.claims).toEqual([]);
      expect(capsule.evidence).toEqual([]);
      await expect(
        verifyCapsule({ capsule, keys: [setupResult.key], audit: setupResult.store }),
      ).resolves.toMatchObject({ valid: true });
    } finally {
      setupResult.secrets.destroy();
      setupResult.master.destroy();
    }
  }, 20_000);
  it("signs, stores, verifies offline, and preserves an append-only audit trail", async () => {
    const setupResult = await setup();
    try {
      const unsigned = unsignedFixture();
      const capsule = await buildCapsule({
        capsule: unsigned,
        approval: {
          policyApprovedClaimIds: unsigned.claims.map((claim) => claim.claim_id),
          policyApprovedEvidenceIds: unsigned.evidence.map((evidence) => evidence.evidence_id),
        },
        key: setupResult.key,
        signer: setupResult.signer,
        audit: setupResult.store,
      });
      await setupResult.store.put(capsule);
      await expect(
        verifyCapsule({ capsule, keys: [setupResult.key], audit: setupResult.store }),
      ).resolves.toMatchObject({ valid: true });
      await expect(setupResult.store.get(capsule.capsule_id)).resolves.toEqual(capsule);
    } finally {
      setupResult.secrets.destroy();
      setupResult.master.destroy();
    }
  }, 20_000);
  it("rejects tampering and explains model-provider replay limitations", async () => {
    const setupResult = await setup();
    try {
      const unsigned = unsignedFixture();
      const capsule = await buildCapsule({
        capsule: unsigned,
        approval: {
          policyApprovedClaimIds: unsigned.claims.map((claim) => claim.claim_id),
          policyApprovedEvidenceIds: unsigned.evidence.map((evidence) => evidence.evidence_id),
        },
        key: setupResult.key,
        signer: setupResult.signer,
        audit: setupResult.store,
      });
      await expect(
        verifyCapsule({ capsule: { ...capsule, disposition: "block" }, keys: [setupResult.key] }),
      ).rejects.toMatchObject({ code: "CAPSULE_SIGNATURE_INVALID" });
      await expect(
        replayCapsule({
          capsule,
          keys: [setupResult.key],
          externalModelAvailable: false,
          processor: async () => "unused",
        }),
      ).resolves.toEqual({ reproducible: false, reason: "EXTERNAL_MODEL_UNAVAILABLE" });
    } finally {
      setupResult.secrets.destroy();
      setupResult.master.destroy();
    }
  }, 20_000);
});
