import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FileSystemSnapshotStore, replaySnapshot } from "../src/index.js";
import type { SnapshotIntegrityError } from "../src/index.js";

const roots: string[] = [];
async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "verus-provenance-"));
  roots.push(value);
  return value;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe("immutable content provenance", () => {
  it("captures, verifies, and replays identical bytes without network access", async () => {
    const directory = await root();
    const store = new FileSystemSnapshotStore(directory);
    const snapshot = await store.capture({
      bytes: Buffer.from("public announcement"),
      componentVersions: { canonicalizer: "1.0", parser: "1.0" },
      parentDigests: [],
      retrievalMetadata: { final_url: "https://example.test/announcement", status: 200 },
    });
    await expect(store.verify(snapshot)).resolves.toBeUndefined();
    await expect(
      replaySnapshot({
        descriptor: snapshot,
        store,
        processor: async (bytes, versions) =>
          `${Buffer.from(bytes).toString("utf8")}:${versions.parser}`,
      }),
    ).resolves.toBe("public announcement:1.0");
    expect(snapshot.objectRef).toMatch(/^snapshot:\/\/sha256\/[0-9a-f]{64}$/);
  });

  it("detects content tampering before replay", async () => {
    const directory = await root();
    const store = new FileSystemSnapshotStore(directory);
    const snapshot = await store.capture({
      bytes: Buffer.from("original"),
      componentVersions: {},
      parentDigests: [],
      retrievalMetadata: {},
    });
    await writeFile(
      join(directory, "content", snapshot.contentDigest.slice("sha256:".length)),
      "tampered",
    );
    await expect(store.readVerified(snapshot)).rejects.toMatchObject({
      code: "DIGEST_MISMATCH",
    } satisfies Partial<SnapshotIntegrityError>);
  });

  it("detects descriptor metadata tampering before replay", async () => {
    const store = new FileSystemSnapshotStore(await root());
    const snapshot = await store.capture({
      bytes: Buffer.from("original"),
      componentVersions: { parser: "1.0" },
      parentDigests: [],
      retrievalMetadata: { status: 200 },
    });
    await expect(
      store.verify({ ...snapshot, componentVersions: { parser: "evil" } }),
    ).rejects.toMatchObject({
      code: "METADATA_MISMATCH",
    } satisfies Partial<SnapshotIntegrityError>);
  });

  it("removes retained content while preserving metadata for permitted audit evidence", async () => {
    const directory = await root();
    const store = new FileSystemSnapshotStore(directory);
    const snapshot = await store.capture({
      bytes: Buffer.from("expired"),
      componentVersions: {},
      parentDigests: [],
      retrievalMetadata: { retrieved_at: "2026-10-01T00:00:00Z" },
    });
    await store.deleteContent(snapshot);
    await expect(store.readVerified(snapshot)).rejects.toMatchObject({
      code: "CONTENT_MISSING",
    } satisfies Partial<SnapshotIntegrityError>);
    await expect(
      readFile(
        join(
          directory,
          "metadata",
          `${snapshot.contentDigest.slice("sha256:".length)}-${snapshot.metadataDigest.slice("sha256:".length)}.json`,
        ),
        "utf8",
      ),
    ).resolves.toContain("retrieved_at");
  });
});
