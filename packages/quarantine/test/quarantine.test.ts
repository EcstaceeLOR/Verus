import { mkdtemp, readFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { EicarSafetyScanner, FileSystemQuarantineStore } from "../src/index.js";

const roots: string[] = [];
async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "verus-quarantine-"));
  roots.push(value);
  return value;
}
async function* bytes(value: Buffer): AsyncGenerator<Buffer> {
  yield value;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe("document quarantine", () => {
  it("stores a clean PDF only as an opaque quarantined object", async () => {
    const store = new FileSystemQuarantineStore(await root());
    const result = await store.ingest({
      declaredMediaType: "application/pdf",
      scanner: new EicarSafetyScanner(),
      stream: bytes(Buffer.from("%PDF-1.7\nbenign")),
    });
    expect(result).toMatchObject({
      mediaType: "application/pdf",
      objectRef: expect.stringMatching(/^quarantine:\/\/sha256\/[0-9a-f]{64}$/),
      state: "clean",
    });
  });

  it("keeps malicious and encrypted documents quarantined without producing a clean result", async () => {
    const store = new FileSystemQuarantineStore(await root());
    const malicious = await store.ingest({
      declaredMediaType: "text/plain",
      scanner: new EicarSafetyScanner(),
      stream: bytes(Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")),
    });
    const encrypted = await store.ingest({
      declaredMediaType: "application/pdf",
      scanner: new EicarSafetyScanner(),
      stream: bytes(Buffer.from("%PDF-1.7\n/Encrypt")),
    });
    expect(malicious.state).toBe("malicious");
    expect(encrypted.state).toBe("rejected");
    expect(malicious.objectRef).toMatch(/^quarantine:/);
    expect(encrypted.objectRef).toMatch(/^quarantine:/);
  });

  it("fails closed and retains the object when its scanner is unavailable", async () => {
    const store = new FileSystemQuarantineStore(await root());
    const result = await store.ingest({
      declaredMediaType: "text/plain",
      scanner: { scan: async () => Promise.reject(new Error("scanner offline")) },
      stream: bytes(Buffer.from("await scanner retry")),
    });
    expect(result.state).toBe("scan_unavailable");
    expect(result.objectRef).toMatch(/^quarantine:/);
  });

  it("rejects mismatched formats before they can enter a parser path", async () => {
    const store = new FileSystemQuarantineStore(await root());
    const result = await store.ingest({
      declaredMediaType: "application/pdf",
      scanner: new EicarSafetyScanner(),
      stream: bytes(Buffer.from("plain text")),
    });
    expect(result.state).toBe("rejected");
  });

  it("never exposes application-origin paths in the upload result", async () => {
    const directory = await root();
    const store = new FileSystemQuarantineStore(directory);
    const result = await store.ingest({
      declaredMediaType: "text/plain",
      scanner: new EicarSafetyScanner(),
      stream: bytes(Buffer.from("private upload")),
    });
    expect(result.objectRef).not.toContain(directory);
    await expect(
      readFile(join(directory, result.digest.slice("sha256:".length)), "utf8"),
    ).resolves.toBe("private upload");
  });

  it("removes expired quarantined objects according to the 30-day retention policy", async () => {
    const directory = await root();
    const store = new FileSystemQuarantineStore(directory);
    const result = await store.ingest({
      declaredMediaType: "text/plain",
      scanner: new EicarSafetyScanner(),
      stream: bytes(Buffer.from("expired")),
    });
    const target = join(directory, result.digest.slice("sha256:".length));
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await utimes(target, old, old);
    await expect(store.cleanupExpired()).resolves.toEqual([result.objectRef]);
  });
});
