import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

import { ContractValidationError } from "./errors.js";
import type { ContextCapsule, IngestionRequest, PolicyVerdict, SourceRecord } from "./types.js";
import { assertSupportedContractVersion } from "./version.js";

type ContractName = "ContextCapsule" | "IngestionRequest" | "PolicyVerdict" | "SourceRecord";
type JsonObject = Record<string, unknown>;

const schemaFiles = [
  "verus.schema.json",
  "context-capsule.schema.json",
  "ingestion-request.schema.json",
  "policy-verdict.schema.json",
  "source-record.schema.json",
] as const;

function schemaDirectory(): URL {
  const bundled = new URL("../schema/v1/", import.meta.url);
  return existsSync(fileURLToPath(bundled))
    ? bundled
    : new URL("../../../contracts/v1/", import.meta.url);
}

function readSchema(filename: (typeof schemaFiles)[number]): object {
  return JSON.parse(readFileSync(new URL(filename, schemaDirectory()), "utf8")) as object;
}

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
for (const filename of schemaFiles) ajv.addSchema(readSchema(filename));

function validator(schemaId: string): ValidateFunction {
  const compiled = ajv.getSchema(schemaId);
  if (compiled === undefined) throw new Error(`Contract schema is unavailable: ${schemaId}`);
  return compiled;
}

const validators = {
  ContextCapsule: validator("https://verus.security/contracts/v1/context-capsule.schema.json"),
  IngestionRequest: validator("https://verus.security/contracts/v1/ingestion-request.schema.json"),
  PolicyVerdict: validator("https://verus.security/contracts/v1/policy-verdict.schema.json"),
  SourceRecord: validator("https://verus.security/contracts/v1/source-record.schema.json"),
} satisfies Record<ContractName, ValidateFunction>;

function safeIssues(errors: null | undefined | readonly ErrorObject[]): readonly {
  path: string;
  keyword: string;
  message: string;
}[] {
  return (errors ?? []).slice(0, 20).map((error) => ({
    path: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message ?? "does not satisfy the contract",
  }));
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function parseContract<T>(name: ContractName, input: unknown): Readonly<T> {
  if (isJsonObject(input) && "schema_version" in input) {
    assertSupportedContractVersion(input.schema_version);
  }
  const validate = validators[name];
  if (!validate(input)) throw new ContractValidationError(name, safeIssues(validate.errors));
  return deepFreeze(structuredClone(input as T));
}

export const parseContextCapsule = (input: unknown): Readonly<ContextCapsule> =>
  parseContract<ContextCapsule>("ContextCapsule", input);

export const parseIngestionRequest = (input: unknown): Readonly<IngestionRequest> =>
  parseContract<IngestionRequest>("IngestionRequest", input);

export const parsePolicyVerdict = (input: unknown): Readonly<PolicyVerdict> =>
  parseContract<PolicyVerdict>("PolicyVerdict", input);

export const parseSourceRecord = (input: unknown): Readonly<SourceRecord> =>
  parseContract<SourceRecord>("SourceRecord", input);
