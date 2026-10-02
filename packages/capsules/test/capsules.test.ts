import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  Ed25519SigningProvider,
  SealedFileSecretProvider,
  SecretValue,
  generateEd25519Key,
} from "@verus/crypto";
import {
  buildCapsule,
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
describe("Context Capsules", () => {
  it("signs, stores, verifies offline, and preserves an append-only audit trail", async () => {
    const setupResult = await setup();
    try {
      const { signature: _signature, ...unsigned } = fixture;
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
      const { signature: _signature, ...unsigned } = fixture;
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
