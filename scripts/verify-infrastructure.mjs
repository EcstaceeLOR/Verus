import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(resolve(root, "deploy", "environments.json"), "utf8"));
const expectedEnvironments = ["preview", "staging", "production"];
const expectedCompute = ["api", "console", "worker", "retriever", "parser", "model-gateway"];
const requiredState = ["postgres", "queue", "object-store"];

if (config.schemaVersion !== 1) throw new Error("Infrastructure schemaVersion must be 1.");
for (const name of expectedEnvironments) {
  const environment = config.environments?.[name];
  if (!environment) throw new Error(`Missing ${name} environment.`);
  if (environment.isolated !== true) throw new Error(`${name} must be isolated.`);
  if (!Number.isInteger(environment.replicas) || environment.replicas < 1) {
    throw new Error(`${name} must have at least one replica.`);
  }
  if (!Number.isInteger(environment.dataRetentionDays) || environment.dataRetentionDays < 1) {
    throw new Error(`${name} must have a positive retention period.`);
  }
}
if (config.environments.preview.branchPolicy !== "pull-request") {
  throw new Error("Preview deployments must be limited to pull requests.");
}
if (config.environments.staging.branchPolicy !== "main") {
  throw new Error("Staging deployments must originate from main.");
}
if (
  config.environments.production.branchPolicy !== "main" ||
  !config.environments.production.approvalRequired
) {
  throw new Error("Production must originate from main and require approval.");
}
if (config.environments.production.replicas < 2) {
  throw new Error("Production requires at least two replicas.");
}
for (const service of expectedCompute) {
  if (!config.resources?.compute?.includes(service))
    throw new Error(`Missing compute service ${service}.`);
}
for (const resource of requiredState) {
  if (!config.resources?.state?.includes(resource))
    throw new Error(`Missing state resource ${resource}.`);
}
if (
  config.resources?.secrets?.applicationReadOnly !== true ||
  config.resources?.secrets?.migrationIdentitySeparate !== true
) {
  throw new Error(
    "Secrets must be read-only to applications and use a separate migration identity.",
  );
}
if (!config.resources?.network?.egressDenied?.includes("parser")) {
  throw new Error("The parser must have denied outbound network access.");
}
if (
  !config.resources?.edge?.every((resource) => ["dns", "tls", "cdn"].includes(resource)) ||
  config.resources.edge.length !== 3
) {
  throw new Error("Edge resources must define DNS, TLS, and CDN.");
}

console.log("Verified isolated preview, staging, and production infrastructure policy.");
