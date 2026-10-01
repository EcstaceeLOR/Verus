import { readFile, readdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expected = new Map([
  ["@verus/api", "apps/api"],
  ["@verus/console", "apps/console"],
  ["@verus/mcp", "apps/mcp"],
  ["@verus/worker", "apps/worker"],
  ["@verus/retriever", "services/retriever"],
  ["@verus/parser", "services/parser"],
  ["@verus/model-gateway", "services/model-gateway"],
  ["@verus/contracts", "packages/contracts"],
  ["@verus/domain", "packages/domain"],
  ["@verus/policy", "packages/policy"],
  ["@verus/evidence", "packages/evidence"],
  ["@verus/crypto", "packages/crypto"],
  ["@verus/persistence", "packages/persistence"],
  ["@verus/jobs", "packages/jobs"],
  ["@verus/observability", "packages/observability"],
  ["@verus/sdk", "packages/sdk"],
  ["@verus/testkit", "packages/testkit"],
]);

const rootPackage = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const nodeVersion = (await readFile(resolve(root, ".node-version"), "utf8")).trim();
const runtimeVersion = process.version.slice(1);

if (runtimeVersion !== nodeVersion) {
  throw new Error(`Node ${nodeVersion} is required; received ${runtimeVersion}`);
}
if (rootPackage.packageManager !== "pnpm@12.8.1") {
  throw new Error("packageManager must pin pnpm@12.8.1");
}
if (rootPackage.engines?.node !== ">=24.19.0 <25") {
  throw new Error("Node engine range differs from the supported runtime");
}

const seen = new Set();
for (const [name, path] of expected) {
  const manifestPath = resolve(root, path, "package.json");
  await access(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.name !== name) throw new Error(`${path} must be named ${name}`);
  if (!manifest.private && !["@verus/contracts", "@verus/sdk"].includes(name)) {
    throw new Error(`${name} must remain private`);
  }
  if (seen.has(manifest.name)) throw new Error(`Duplicate package name ${manifest.name}`);
  seen.add(manifest.name);

  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const [dependency, version] of Object.entries(manifest[field] ?? {})) {
      if (dependency.startsWith("@verus/") && !String(version).startsWith("workspace:")) {
        throw new Error(`${name} must use workspace protocol for ${dependency}`);
      }
      if (version === "*" || version === "latest") {
        throw new Error(`${name} has unpinned ${field} entry ${dependency}`);
      }
    }
  }
}

for (const workspaceRoot of ["apps", "packages", "services"]) {
  const entries = await readdir(resolve(root, workspaceRoot), { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const relative = `${workspaceRoot}/${entry.name}`;
    if (![...expected.values()].includes(relative)) {
      throw new Error(`Undeclared workspace directory ${relative}`);
    }
  }
}

await access(resolve(root, "pnpm-lock.yaml"));
console.log(`Verified Node ${nodeVersion}, pnpm 12.8.1, and ${seen.size} workspace packages.`);
