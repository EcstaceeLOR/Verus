import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

function canonicalize(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JCS forbids non-finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`JCS cannot serialize ${typeof value}`);
}

const vectorUrl = new URL("./fixtures/canonicalization-vectors.json", import.meta.url);
const vectors = JSON.parse(await readFile(vectorUrl, "utf8"));

for (const vector of vectors) {
  const actual = canonicalize(vector.input);
  if (actual !== vector.canonical) {
    throw new Error(`${vector.name}: canonical bytes differ`);
  }

  const digest = `sha256:${createHash("sha256").update(actual, "utf8").digest("hex")}`;
  if (digest !== vector.sha256) {
    throw new Error(`${vector.name}: digest differs (${digest})`);
  }
}

console.log(`Verified ${vectors.length} canonicalization vectors.`);
