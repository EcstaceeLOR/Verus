import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

export const PROVENANCE_VERSION = "1.0" as const;
export interface SnapshotDescriptor {
  readonly componentVersions: Readonly<Record<string, string>>;
  readonly contentDigest: string;
  readonly metadataDigest: string;
  readonly objectRef: string;
  readonly parentDigests: readonly string[];
  readonly retrievalMetadata: Readonly<Record<string, unknown>>;
}
export class SnapshotIntegrityError extends Error {
  constructor(
    readonly code: "CONTENT_MISSING" | "DIGEST_MISMATCH" | "METADATA_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "SnapshotIntegrityError";
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function digest(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
function digestName(value: string): string {
  return value.slice("sha256:".length);
}
function snapshotRef(contentDigest: string): string {
  return `snapshot://sha256/${digestName(contentDigest)}`;
}
function metadataPayload(
  descriptor: Omit<SnapshotDescriptor, "metadataDigest"> & Readonly<{ metadataDigest?: string }>,
): string {
  const { metadataDigest, ...payload } = descriptor;
  void metadataDigest;
  return canonical({ ...payload, provenanceVersion: PROVENANCE_VERSION });
}
function assertDigest(value: string): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) throw new TypeError("Invalid content digest.");
}

/** Private content-addressed snapshot store. Paths are never returned to callers. */
export class FileSystemSnapshotStore {
  readonly #root: string;
  constructor(root: string) {
    this.#root = resolve(root);
  }

  async capture(
    input: Readonly<{
      bytes: Uint8Array;
      componentVersions: Readonly<Record<string, string>>;
      parentDigests: readonly string[];
      retrievalMetadata: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<Readonly<SnapshotDescriptor>> {
    input.parentDigests.forEach(assertDigest);
    const contentDigest = digest(input.bytes);
    const descriptor = Object.freeze({
      componentVersions: Object.freeze({ ...input.componentVersions }),
      contentDigest,
      objectRef: snapshotRef(contentDigest),
      parentDigests: Object.freeze([...input.parentDigests].sort()),
      retrievalMetadata: Object.freeze({ ...input.retrievalMetadata }),
    });
    const metadataBytes = metadataPayload(descriptor);
    const metadataDigest = digest(metadataBytes);
    await mkdir(join(this.#root, "content"), { recursive: true, mode: 0o700 });
    await mkdir(join(this.#root, "metadata"), { recursive: true, mode: 0o700 });
    const contentPath = join(this.#root, "content", digestName(contentDigest));
    const metadataPath = join(
      this.#root,
      "metadata",
      `${digestName(contentDigest)}-${digestName(metadataDigest)}.json`,
    );
    await this.#writeImmutable(contentPath, input.bytes);
    await this.#writeImmutable(metadataPath, metadataBytes);
    return Object.freeze({ ...descriptor, metadataDigest });
  }

  async verify(descriptor: SnapshotDescriptor): Promise<void> {
    const contentPath = join(this.#root, "content", digestName(descriptor.contentDigest));
    const metadataPath = join(
      this.#root,
      "metadata",
      `${digestName(descriptor.contentDigest)}-${digestName(descriptor.metadataDigest)}.json`,
    );
    let bytes: Buffer;
    try {
      bytes = await readFile(contentPath);
    } catch {
      throw new SnapshotIntegrityError("CONTENT_MISSING", "Snapshot content is unavailable.");
    }
    if (digest(bytes) !== descriptor.contentDigest)
      throw new SnapshotIntegrityError(
        "DIGEST_MISMATCH",
        "Snapshot content digest does not match.",
      );
    if (digest(metadataPayload(descriptor)) !== descriptor.metadataDigest)
      throw new SnapshotIntegrityError(
        "METADATA_MISMATCH",
        "Snapshot descriptor metadata does not match.",
      );
    let metadata: Buffer;
    try {
      metadata = await readFile(metadataPath);
    } catch {
      throw new SnapshotIntegrityError("METADATA_MISMATCH", "Snapshot metadata is unavailable.");
    }
    if (digest(metadata) !== descriptor.metadataDigest)
      throw new SnapshotIntegrityError(
        "METADATA_MISMATCH",
        "Snapshot metadata digest does not match.",
      );
  }

  async readVerified(descriptor: SnapshotDescriptor): Promise<Uint8Array> {
    await this.verify(descriptor);
    return readFile(join(this.#root, "content", digestName(descriptor.contentDigest)));
  }

  async deleteContent(descriptor: SnapshotDescriptor): Promise<void> {
    await rm(join(this.#root, "content", digestName(descriptor.contentDigest)), { force: true });
  }

  async #writeImmutable(target: string, value: Uint8Array | string): Promise<void> {
    try {
      await open(target, "wx", 0o600).then(async (handle) => {
        await handle.writeFile(value);
        await handle.close();
      });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const current = await readFile(target);
    if (digest(current) !== digest(value))
      throw new SnapshotIntegrityError(
        "DIGEST_MISMATCH",
        "Existing content-addressed object was modified.",
      );
  }
}

/** Replays only captured bytes; the processor receives no retrieval or network capability. */
export async function replaySnapshot<Result>(
  input: Readonly<{
    descriptor: SnapshotDescriptor;
    processor: (
      bytes: Uint8Array,
      componentVersions: Readonly<Record<string, string>>,
    ) => Promise<Result>;
    store: FileSystemSnapshotStore;
  }>,
): Promise<Result> {
  const bytes = await input.store.readVerified(input.descriptor);
  return input.processor(bytes, input.descriptor.componentVersions);
}

export function createSnapshotId(): string {
  return `snap_${randomUUID().replaceAll("-", "").slice(0, 26).toUpperCase()}`;
}
