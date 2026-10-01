import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export const QUARANTINE_POLICY_VERSION = "1.0" as const;
export const QUARANTINE_LIMITS = Object.freeze({ maxBytes: 100 * 1024 * 1024, retentionDays: 30 });

export type QuarantineState = "clean" | "malicious" | "rejected" | "scan_unavailable";
export class QuarantineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "QuarantineError";
  }
}
export interface SafetyScanner {
  scan(
    content: Readonly<{ digest: string; path: string; sizeBytes: number }>,
  ): Promise<QuarantineState>;
}
export interface QuarantinedUpload {
  readonly createdAt: Date;
  readonly digest: string;
  readonly mediaType: string;
  readonly objectRef: string;
  readonly sizeBytes: number;
  readonly state: QuarantineState;
}

function detectMediaType(prefix: Buffer, declared: string): string {
  const pdf = prefix.subarray(0, 5).equals(Buffer.from("%PDF-"));
  const zip = prefix.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const text = !prefix.includes(0);
  if (pdf && declared === "application/pdf") return declared;
  if (
    zip &&
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ].includes(declared)
  )
    return declared;
  if (text && ["text/plain", "text/csv"].includes(declared)) return declared;
  throw new QuarantineError("TYPE_MISMATCH", "Declared type does not match quarantined content.");
}
function encrypted(prefix: Buffer, mediaType: string): boolean {
  if (mediaType === "application/pdf") return prefix.includes(Buffer.from("/Encrypt"));
  return prefix.subarray(0, 8).includes(Buffer.from([0x01]));
}
function quarantineRef(digest: string): string {
  return `quarantine://sha256/${digest.slice("sha256:".length)}`;
}

export class FileSystemQuarantineStore {
  readonly #root: string;
  constructor(root: string) {
    this.#root = resolve(root);
  }
  async ingest(
    input: Readonly<{
      declaredMediaType: string;
      stream: AsyncIterable<Uint8Array>;
      scanner: SafetyScanner;
    }>,
  ): Promise<Readonly<QuarantinedUpload>> {
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    const temporary = join(this.#root, `.stage-${randomUUID()}`);
    const handle = await open(temporary, "wx", 0o600);
    const hash = createHash("sha256");
    const prefixChunks: Buffer[] = [];
    let prefixSize = 0;
    let sizeBytes = 0;
    try {
      for await (const chunkValue of input.stream) {
        const chunk = Buffer.from(chunkValue);
        sizeBytes += chunk.length;
        if (sizeBytes > QUARANTINE_LIMITS.maxBytes)
          throw new QuarantineError("UPLOAD_LIMIT", "Upload exceeds quarantine byte limit.");
        hash.update(chunk);
        await handle.write(chunk);
        if (prefixSize < 1024 * 1024) {
          const part = chunk.subarray(0, 1024 * 1024 - prefixSize);
          prefixChunks.push(part);
          prefixSize += part.length;
        }
      }
      if (sizeBytes === 0) throw new QuarantineError("EMPTY_UPLOAD", "Upload is empty.");
      const digest = `sha256:${hash.digest("hex")}`;
      const prefix = Buffer.concat(prefixChunks);
      let mediaType: string;
      let state: QuarantineState;
      try {
        mediaType = detectMediaType(prefix, input.declaredMediaType);
        if (encrypted(prefix, mediaType)) state = "rejected";
        else {
          try {
            state = await input.scanner.scan({ digest, path: temporary, sizeBytes });
          } catch {
            // A scanner outage must never turn into an allowed upload or destroy
            // the evidence needed for a safe retry.
            state = "scan_unavailable";
          }
        }
      } catch (error) {
        if (error instanceof QuarantineError) {
          mediaType = input.declaredMediaType;
          state = "rejected";
        } else throw error;
      }
      const target = join(this.#root, digest.slice("sha256:".length));
      await handle.close();
      await rename(temporary, target);
      return Object.freeze({
        createdAt: new Date(),
        digest,
        mediaType,
        objectRef: quarantineRef(digest),
        sizeBytes,
        state,
      });
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async cleanupExpired(now: Date = new Date()): Promise<readonly string[]> {
    const cutoff = now.getTime() - QUARANTINE_LIMITS.retentionDays * 24 * 60 * 60 * 1000;
    const removed: string[] = [];
    for (const entry of await readdir(this.#root).catch(() => [] as string[])) {
      if (!/^[0-9a-f]{64}$/u.test(entry)) continue;
      const target = join(this.#root, entry);
      if ((await stat(target)).mtime.getTime() >= cutoff) continue;
      await rm(target, { force: true });
      removed.push(`quarantine://sha256/${entry}`);
    }
    return Object.freeze(removed);
  }
}

export class EicarSafetyScanner implements SafetyScanner {
  async scan(
    content: Readonly<{ digest: string; path: string; sizeBytes: number }>,
  ): Promise<QuarantineState> {
    void content.digest;
    void content.sizeBytes;
    const handle = await open(content.path, "r");
    try {
      const bytes = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      return bytes
        .subarray(0, bytesRead)
        .includes(Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE"))
        ? "malicious"
        : "clean";
    } finally {
      await handle.close();
    }
  }
}
