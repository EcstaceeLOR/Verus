import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  Ed25519SigningProvider,
  SealedFileSecretProvider,
  SecretValue,
  generateEd25519Key,
  issueApiKey,
  verifyApiKey,
  verifyEd25519Signature,
} from "../src/index.js";

let secretDirectory: string;
let masterKey: SecretValue;
let provider: SealedFileSecretProvider;

beforeAll(async () => {
  secretDirectory = await mkdtemp(join(tmpdir(), "verus-crypto-test-"));
  masterKey = new SecretValue(randomBytes(32));
  provider = new SealedFileSecretProvider(secretDirectory, masterKey);
});

afterAll(async () => {
  provider.destroy();
  masterKey.destroy();
  const resolved = resolve(secretDirectory);
  if (!resolved.startsWith(resolve(tmpdir(), "verus-crypto-test-"))) {
    throw new Error("Refusing to remove an unexpected test directory.");
  }
  await rm(resolved, { recursive: true, force: true });
});

describe("API keys", () => {
  it("reveals a generated key once and verifies it in constant-shape form", () => {
    const pepper = new SecretValue(randomBytes(32));
    try {
      const issued = issueApiKey(
        "key_01ARZ3NDEKTSV4RRFFQ69G5FB1",
        ["scan.create", "scan.read"],
        pepper,
      );
      const serialized = JSON.stringify(issued);
      expect(serialized).not.toContain("hmac-sha256");
      const plaintext = issued.revealOnce();
      expect(serialized).not.toContain(plaintext);
      expect(serialized).not.toContain(plaintext.split(".")[2] as string);
      expect(verifyApiKey(plaintext, issued.metadata, pepper)).toBe(true);
      expect(verifyApiKey(`${plaintext}x`, issued.metadata, pepper)).toBe(false);
      expect(() => issued.revealOnce()).toThrow("already been revealed");
    } finally {
      pepper.destroy();
    }
  });

  it("redacts secret values from string and JSON serialization", () => {
    const secret = new SecretValue(Buffer.from("do-not-log"));
    expect(String(secret)).toBe("[REDACTED]");
    expect(JSON.stringify({ secret })).toBe('{"secret":"[REDACTED]"}');
    secret.destroy();
    expect(() => secret.use(() => undefined)).toThrow("destroyed");
  });
});

describe("sealed secret provider", () => {
  it("stores authenticated ciphertext and never plaintext", async () => {
    const value = new SecretValue(Buffer.from("provider-secret-value"));
    await provider.put("connector/example", value);
    value.destroy();

    const stored = await readFile(join(secretDirectory, "connector--example.sealed.json"), "utf8");
    expect(stored).not.toContain("provider-secret-value");
    await expect(
      provider.withSecret("connector/example", (secret) =>
        secret.use((bytes) => Buffer.from(bytes).toString("utf8")),
      ),
    ).resolves.toBe("provider-secret-value");
  });
});

describe("Ed25519 signing lifecycle", () => {
  it("rotates without downtime and keeps retired public keys verifiable", async () => {
    const oldKey = await generateEd25519Key(
      "key_01ARZ3NDEKTSV4RRFFQ69G5FB2",
      "signing/old",
      provider,
    );
    const newKey = await generateEd25519Key(
      "key_01ARZ3NDEKTSV4RRFFQ69G5FB3",
      "signing/new",
      provider,
    );
    const signer = new Ed25519SigningProvider(provider);
    const bytes = Buffer.from('{"schema_version":"1.0"}', "utf8");
    const artifactDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const oldSignature = await signer.sign({
      purpose: "context_capsule",
      keyId: oldKey.keyId,
      providerReference: "signing/old",
      artifactDigest,
      canonicalBytes: bytes,
    });
    const newSignature = await signer.sign({
      purpose: "context_capsule",
      keyId: newKey.keyId,
      providerReference: "signing/new",
      artifactDigest,
      canonicalBytes: bytes,
    });

    expect(verifyEd25519Signature(bytes, oldSignature, oldKey.publicKey)).toBe(true);
    expect(verifyEd25519Signature(bytes, newSignature, newKey.publicKey)).toBe(true);
    await provider.delete("signing/old");
    expect(verifyEd25519Signature(bytes, oldSignature, oldKey.publicKey)).toBe(true);
    await expect(
      signer.sign({
        purpose: "context_capsule",
        keyId: oldKey.keyId,
        providerReference: "signing/old",
        artifactDigest,
        canonicalBytes: bytes,
      }),
    ).rejects.toThrow();
  });

  it("refuses to sign bytes that do not match the declared digest", async () => {
    const signer = new Ed25519SigningProvider(provider);
    await expect(
      signer.sign({
        purpose: "context_capsule",
        keyId: "key_01ARZ3NDEKTSV4RRFFQ69G5FB3",
        providerReference: "signing/new",
        artifactDigest: `sha256:${"0".repeat(64)}`,
        canonicalBytes: Buffer.from("different"),
      }),
    ).rejects.toThrow("digest does not match");
  });
});
