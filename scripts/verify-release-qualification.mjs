import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const matrix = JSON.parse(
  await readFile(resolve(root, "docs/release/qualification-v1.json"), "utf8"),
);
if (matrix.schemaVersion !== 1 || matrix.releaseCandidate !== "v1")
  throw new Error("Invalid release qualification matrix.");
const seen = new Set();
for (const entry of matrix.requiredEvidence) {
  if (!/^(W[1-6]|SEC-\d\d|PRIV-\d\d|OPS-\d\d|UX-\d\d)$/.test(entry.id) || !seen.add(entry.id))
    throw new Error("Qualification IDs must be unique and recognized.");
  if (!Array.isArray(entry.evidence) || entry.evidence.length < 1)
    throw new Error(`${entry.id} has no evidence.`);
  for (const path of entry.evidence) {
    if (typeof path !== "string" || path.startsWith("/") || path.includes(".."))
      throw new Error(`${entry.id} has unsafe evidence path.`);
    await access(resolve(root, path));
  }
}
for (const workflow of ["W1", "W2", "W3", "W4", "W5", "W6"]) {
  if (!seen.has(workflow)) throw new Error(`Missing required workflow ${workflow}.`);
}
console.log(
  `Verified release qualification evidence for ${matrix.requiredEvidence.length} requirements.`,
);
