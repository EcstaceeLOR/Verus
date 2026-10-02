import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const record = JSON.parse(await readFile(resolve(root, "docs/release/go-no-go.v1.json"), "utf8"));
if (record.schemaVersion !== 1 || !["go", "no-go"].includes(record.decision))
  throw new Error("Invalid release decision.");
for (const role of ["release", "security", "operations", "product"]) {
  if (typeof record.owners?.[role] !== "string" || record.owners[role].length < 3)
    throw new Error(`Missing ${role} decision owner.`);
}
const blockers = Array.isArray(record.blockers) ? record.blockers : [];
for (const blocker of blockers) {
  if (!/^[a-z0-9-]{3,80}$/.test(blocker.id) || !["open", "closed"].includes(blocker.status))
    throw new Error("Invalid release blocker.");
}
if (record.decision === "go") {
  if (!/^[0-9a-f]{40}$/.test(record.releaseCandidate))
    throw new Error("Go decision requires immutable release commit.");
  if (typeof record.reviewedAt !== "string" || Number.isNaN(Date.parse(record.reviewedAt)))
    throw new Error("Go decision requires review timestamp.");
  if (blockers.some((blocker) => blocker.status !== "closed"))
    throw new Error("Go decision has open blockers.");
  if (!Array.isArray(record.artifacts) || record.artifacts.length < 2)
    throw new Error("Go decision requires independently verifiable artifacts.");
}
console.log(
  `Verified ${record.decision} release decision with ${blockers.length} blocker records.`,
);
