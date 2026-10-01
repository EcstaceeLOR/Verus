import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = resolve(root, "artifacts");
const projects = Object.freeze([
  ["api", "apps/api"],
  ["console", "apps/console"],
  ["contracts", "packages/contracts"],
  ["crypto", "packages/crypto"],
  ["domain", "packages/domain"],
  ["jobs", "packages/jobs"],
  ["ingestion", "packages/ingestion"],
  ["observability", "packages/observability"],
  ["persistence", "packages/persistence"],
  ["testkit", "packages/testkit"],
  ["worker", "apps/worker"],
]);

await rm(artifactRoot, { recursive: true, force: true });
await mkdir(resolve(artifactRoot, "test"), { recursive: true });
await mkdir(resolve(artifactRoot, "coverage"), { recursive: true });

const vitestEntry = resolve(root, "node_modules", "vitest", "vitest.mjs");
for (const [name, directory] of projects) {
  const result = spawnSync(
    process.execPath,
    [
      vitestEntry,
      "run",
      "--exclude",
      "test/postgres.integration.test.ts",
      "--reporter=default",
      "--reporter=junit",
      `--outputFile.junit=${resolve(artifactRoot, "test", `${name}.xml`)}`,
      "--coverage.enabled",
      "--coverage.provider=v8",
      "--coverage.reporter=json-summary",
      `--coverage.reportsDirectory=${resolve(artifactRoot, "coverage", name)}`,
    ],
    { cwd: resolve(root, directory), stdio: "inherit" },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
