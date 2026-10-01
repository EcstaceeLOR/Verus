import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { AuthorizationAction } from "@verus/domain";

import type { SecretValue } from "./secret-provider.js";

export interface ApiKeyVerifier {
  readonly keyId: string;
  readonly prefix: string;
  readonly verifier: string;
  readonly scopes: readonly AuthorizationAction[];
}

export class IssuedApiKey {
  readonly metadata: Readonly<ApiKeyVerifier>;
  #plaintext: Buffer | undefined;

  constructor(metadata: ApiKeyVerifier, plaintext: Buffer) {
    this.metadata = Object.freeze({ ...metadata, scopes: Object.freeze([...metadata.scopes]) });
    this.#plaintext = plaintext;
  }

  revealOnce(): string {
    if (this.#plaintext === undefined) throw new Error("API key has already been revealed.");
    const value = this.#plaintext.toString("utf8");
    this.#plaintext.fill(0);
    this.#plaintext = undefined;
    return value;
  }

  toJSON(): Readonly<Omit<ApiKeyVerifier, "verifier">> {
    const { keyId, prefix, scopes } = this.metadata;
    return Object.freeze({ keyId, prefix, scopes });
  }
}

function digest(pepper: SecretValue, plaintext: string): Buffer {
  return pepper.use((bytes) => createHmac("sha256", bytes).update(plaintext, "utf8").digest());
}

export function issueApiKey(
  keyId: string,
  scopes: readonly AuthorizationAction[],
  pepper: SecretValue,
): IssuedApiKey {
  if (!/^key_[0-9A-HJKMNP-TV-Z]{26}$/.test(keyId)) throw new TypeError("Invalid API key ID.");
  if (scopes.length === 0 || new Set(scopes).size !== scopes.length) {
    throw new TypeError("API key scopes must be non-empty and unique.");
  }
  const secret = randomBytes(32).toString("base64url");
  const plaintext = `vrk.${keyId}.${secret}`;
  const digestBytes = digest(pepper, plaintext);
  const verifier = `hmac-sha256:${digestBytes.toString("hex")}`;
  digestBytes.fill(0);
  return new IssuedApiKey(
    { keyId, prefix: plaintext.slice(0, 20), verifier, scopes },
    Buffer.from(plaintext, "utf8"),
  );
}

export function verifyApiKey(
  plaintext: string,
  record: Pick<ApiKeyVerifier, "keyId" | "verifier">,
  pepper: SecretValue,
): boolean {
  const parts = plaintext.split(".");
  if (parts.length !== 3 || parts[0] !== "vrk" || parts[1] !== record.keyId) return false;
  if (!/^hmac-sha256:[0-9a-f]{64}$/.test(record.verifier)) return false;
  const expected = Buffer.from(record.verifier.slice("hmac-sha256:".length), "hex");
  const actual = digest(pepper, plaintext);
  try {
    return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
  } finally {
    expected.fill(0);
    actual.fill(0);
  }
}
