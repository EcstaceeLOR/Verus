import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";

import { SecretValue, type SecretProvider } from "./secret-provider.js";

export interface PublicSigningKey {
  readonly keyId: string;
  readonly algorithm: "Ed25519";
  readonly publicKey: string;
}

export interface CapsuleSignRequest {
  readonly purpose: "context_capsule";
  readonly keyId: string;
  readonly providerReference: string;
  readonly artifactDigest: string;
  readonly canonicalBytes: Uint8Array;
}

export async function generateEd25519Key(
  keyId: string,
  providerReference: string,
  provider: SecretProvider,
): Promise<Readonly<PublicSigningKey>> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateDer = privateKey.export({ format: "der", type: "pkcs8" });
  const secret = new SecretValue(privateDer);
  privateDer.fill(0);
  try {
    await provider.put(providerReference, secret);
  } finally {
    secret.destroy();
  }
  return Object.freeze({
    keyId,
    algorithm: "Ed25519",
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  });
}

export class Ed25519SigningProvider {
  readonly #secrets: SecretProvider;

  constructor(secrets: SecretProvider) {
    this.#secrets = secrets;
  }

  async sign(request: CapsuleSignRequest): Promise<string> {
    if (request.purpose !== "context_capsule") throw new TypeError("Unsupported signing purpose.");
    const actualDigest = `sha256:${createHash("sha256").update(request.canonicalBytes).digest("hex")}`;
    if (actualDigest !== request.artifactDigest)
      throw new Error("Artifact digest does not match bytes.");
    return this.#secrets.withSecret(request.providerReference, (secret) =>
      secret.use((privateDer) =>
        sign(
          null,
          request.canonicalBytes,
          createPrivateKey({ key: Buffer.from(privateDer), format: "der", type: "pkcs8" }),
        ).toString("base64url"),
      ),
    );
  }
}

export function verifyEd25519Signature(
  canonicalBytes: Uint8Array,
  signature: string,
  publicKey: string,
): boolean {
  try {
    return verify(
      null,
      canonicalBytes,
      createPublicKey({ key: Buffer.from(publicKey, "base64url"), format: "der", type: "spki" }),
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}
