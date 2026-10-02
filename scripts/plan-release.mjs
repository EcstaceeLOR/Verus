import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2)
  options.set(process.argv[index], process.argv[index + 1]);
const environmentName = options.get("--environment");
const operation = options.get("--operation") ?? "deploy";
const releasePath = options.get("--release");
if (!environmentName || !releasePath || !["deploy", "rollback"].includes(operation)) {
  throw new Error(
    "Usage: node scripts/plan-release.mjs --environment <name> --release <file> [--operation deploy|rollback]",
  );
}

const infrastructure = JSON.parse(
  await readFile(resolve(root, "deploy", "environments.json"), "utf8"),
);
const release = JSON.parse(await readFile(resolve(root, releasePath), "utf8")).release;
const environment = infrastructure.environments?.[environmentName];
if (!environment) throw new Error(`Unknown environment ${environmentName}.`);
if (!/^[0-9a-f]{40}$/.test(release?.revision ?? ""))
  throw new Error("Release revision must be a full commit SHA.");
if (release?.migration?.backwardCompatible !== true || release?.migration?.mode !== "expand") {
  throw new Error("Only backward-compatible expand migrations may be promoted.");
}
for (const service of infrastructure.resources.compute) {
  const image = release?.images?.[service];
  if (typeof image !== "string" || !/@sha256:[0-9a-f]{64}$/.test(image)) {
    throw new Error(`${service} must use an immutable image digest.`);
  }
}
if (operation === "rollback" && !/^[0-9a-f]{40}$/.test(release?.previousRevision ?? "")) {
  throw new Error("Rollback requires a full previousRevision SHA.");
}

console.log(
  JSON.stringify({
    environment: environmentName,
    operation,
    revision: release.revision,
    steps: ["backup-check", "migration", "deploy", "smoke-test", "promote"],
  }),
);
