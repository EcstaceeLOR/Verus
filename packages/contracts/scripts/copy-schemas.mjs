import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(packageRoot, "..", "..", "contracts", "v1");
const destination = resolve(packageRoot, "dist", "schema", "v1");
const schemas = [
  "verus.schema.json",
  "context-capsule.schema.json",
  "ingestion-request.schema.json",
  "policy-verdict.schema.json",
  "source-record.schema.json",
];

await rm(destination, { force: true, recursive: true });
await mkdir(destination, { recursive: true });
await Promise.all(
  schemas.map((schema) => cp(resolve(source, schema), resolve(destination, schema))),
);
