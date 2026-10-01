import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export class SecretValue {
  #bytes: Uint8Array;
  #destroyed = false;

  constructor(bytes: Uint8Array) {
    this.#bytes = Uint8Array.from(bytes);
  }

  use<T>(operation: (bytes: Uint8Array) => T): T {
    if (this.#destroyed) throw new Error("Secret value has been destroyed.");
    return operation(this.#bytes);
  }

  destroy(): void {
    this.#bytes.fill(0);
    this.#destroyed = true;
  }

  toJSON(): string {
    return "[REDACTED]";
  }

  toString(): string {
    return "[REDACTED]";
  }
}

export interface SecretProvider {
  put(reference: string, value: SecretValue): Promise<void>;
  withSecret<T>(reference: string, operation: (value: SecretValue) => Promise<T> | T): Promise<T>;
  delete(reference: string): Promise<void>;
}

interface SealedEnvelope {
  readonly version: 1;
  readonly algorithm: "aes-256-gcm";
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

function validateReference(reference: string): void {
  if (!/^[a-z][a-z0-9_-]{1,63}\/[a-z][a-z0-9_-]{1,127}$/.test(reference)) {
    throw new TypeError("Invalid secret reference.");
  }
}

export class SealedFileSecretProvider implements SecretProvider {
  readonly #directory: string;
  readonly #masterKey: Buffer;
  #destroyed = false;

  constructor(directory: string, masterKey: SecretValue) {
    if (!isAbsolute(directory)) throw new TypeError("Secret directory must be absolute.");
    this.#directory = directory;
    this.#masterKey = masterKey.use((bytes) => {
      if (bytes.byteLength !== 32) throw new TypeError("Sealing master key must be 32 bytes.");
      return Buffer.from(bytes);
    });
  }

  async put(reference: string, value: SecretValue): Promise<void> {
    this.#assertAvailable();
    validateReference(reference);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#masterKey, iv);
    cipher.setAAD(Buffer.from(reference, "utf8"));
    const ciphertext = value.use((bytes) => Buffer.concat([cipher.update(bytes), cipher.final()]));
    const envelope: SealedEnvelope = {
      version: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };
    const path = this.#path(reference);
    const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await writeFile(temporary, JSON.stringify(envelope), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    try {
      await link(temporary, path);
    } finally {
      await unlink(temporary).catch(() => undefined);
      ciphertext.fill(0);
    }
  }

  async withSecret<T>(
    reference: string,
    operation: (value: SecretValue) => Promise<T> | T,
  ): Promise<T> {
    this.#assertAvailable();
    validateReference(reference);
    const envelope = JSON.parse(await readFile(this.#path(reference), "utf8")) as SealedEnvelope;
    if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm") {
      throw new Error("Unsupported sealed-secret envelope.");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.#masterKey,
      Buffer.from(envelope.iv, "base64url"),
    );
    decipher.setAAD(Buffer.from(reference, "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final(),
    ]);
    const secret = new SecretValue(plaintext);
    plaintext.fill(0);
    try {
      return await operation(secret);
    } finally {
      secret.destroy();
    }
  }

  async delete(reference: string): Promise<void> {
    this.#assertAvailable();
    validateReference(reference);
    await unlink(this.#path(reference));
  }

  #path(reference: string): string {
    return join(this.#directory, `${reference.replace("/", "--")}.sealed.json`);
  }

  destroy(): void {
    this.#masterKey.fill(0);
    this.#destroyed = true;
  }

  #assertAvailable(): void {
    if (this.#destroyed) throw new Error("Secret provider has been destroyed.");
  }
}
