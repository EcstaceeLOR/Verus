#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseContextCapsule, type IngestionRequest } from "@verus/contracts";
import type { PublicSigningKey } from "@verus/crypto";

import {
  VerusApiError,
  VerusClient,
  VerusConfigurationError,
  VerusWaitTimeoutError,
  verifyCapsuleOffline,
  type ScanState,
} from "./index.js";

export const EXIT = Object.freeze({
  SUCCESS: 0,
  REVIEW: 2,
  BLOCKED: 3,
  SCAN_FAILED: 4,
  USAGE: 64,
  DATA: 65,
  UNAVAILABLE: 69,
  SOFTWARE: 70,
  TEMPORARY: 75,
  PERMISSION: 77,
  CONFIGURATION: 78,
  TIMEOUT: 124,
} as const);

type Output = (value: unknown) => void;
interface Dependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

class CliUsageError extends Error {}
class CliDataError extends Error {}

const USAGE = Object.freeze({
  commands: Object.freeze([
    "verus scan <request.json>",
    "verus wait <scan-id> [--timeout-ms <ms>] [--interval-ms <ms>]",
    "verus inspect <scan-id>",
    "verus status <scan-id>",
    "verus verify <capsule.json> <public-keys.json>",
    "verus policy <scan-id>",
    "verus replay <request.json>",
  ]),
  output: "JSON Lines on stdout",
});

function required(
  env: Readonly<Record<string, string | undefined>>,
  name: "VERUS_API_URL" | "VERUS_API_KEY" | "VERUS_WORKSPACE_ID",
): string {
  const value = env[name];
  if (!value) throw new VerusConfigurationError(`${name} is required.`);
  return value;
}
function argument(value: string | undefined): string {
  if (!value || value.startsWith("--")) throw new CliUsageError();
  return value;
}
async function jsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new CliDataError();
  }
}
function publicKeys(value: unknown): readonly PublicSigningKey[] {
  if (!Array.isArray(value)) throw new CliDataError();
  const keys = value.map((candidate) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !Object.hasOwn(candidate, "keyId") ||
      !Object.hasOwn(candidate, "algorithm") ||
      !Object.hasOwn(candidate, "publicKey")
    )
      throw new CliDataError();
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.keyId !== "string" ||
      record.algorithm !== "Ed25519" ||
      typeof record.publicKey !== "string"
    )
      throw new CliDataError();
    return Object.freeze({
      keyId: record.keyId,
      algorithm: record.algorithm,
      publicKey: record.publicKey,
    });
  });
  return Object.freeze(keys);
}
function capsule(value: unknown) {
  try {
    return parseContextCapsule(value);
  } catch {
    throw new CliDataError();
  }
}
function exact(argv: readonly string[], length: number): void {
  if (argv.length !== length) throw new CliUsageError();
}
function waitFlags(argv: readonly string[]): Readonly<{ timeoutMs: number; intervalMs: number }> {
  let timeoutMs = 120_000;
  let intervalMs = 1_000;
  const seen = new Set<string>();
  for (let index = 2; index < argv.length; index += 2) {
    const flag = argv[index];
    const raw = argv[index + 1];
    if (
      (flag !== "--timeout-ms" && flag !== "--interval-ms") ||
      seen.has(flag) ||
      !raw ||
      !/^\d+$/u.test(raw) ||
      Number(raw) < 1
    )
      throw new CliUsageError();
    seen.add(flag);
    if (flag === "--timeout-ms") timeoutMs = Number(raw);
    else intervalMs = Number(raw);
  }
  return Object.freeze({ timeoutMs, intervalMs });
}
function stateExit(state: ScanState): number {
  if (state === "review") return EXIT.REVIEW;
  if (state === "blocked") return EXIT.BLOCKED;
  if (state === "failed" || state === "cancelled") return EXIT.SCAN_FAILED;
  return EXIT.SUCCESS;
}
function dispositionExit(disposition: "allow" | "review" | "block"): number {
  return disposition === "allow"
    ? EXIT.SUCCESS
    : disposition === "review"
      ? EXIT.REVIEW
      : EXIT.BLOCKED;
}
function client(dependencies: Dependencies): VerusClient {
  const env = dependencies.env ?? process.env;
  return new VerusClient({
    baseUrl: required(env, "VERUS_API_URL"),
    apiKey: required(env, "VERUS_API_KEY"),
    workspaceId: required(env, "VERUS_WORKSPACE_ID"),
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    ...(dependencies.sleep === undefined ? {} : { sleep: dependencies.sleep }),
  });
}

/** Executes one command and emits exactly one JSON value; credentials are never included. */
export async function run(
  argv: readonly string[],
  output: Output = (value) => process.stdout.write(`${JSON.stringify(value)}\n`),
  dependencies: Dependencies = {},
): Promise<number> {
  try {
    const [command, first, second] = argv;
    if (command === "help" || command === "--help" || command === "-h") {
      output(USAGE);
      return EXIT.SUCCESS;
    }
    if (command === "verify") {
      exact(argv, 3);
      const parsedCapsule = capsule(await jsonFile(argument(first)));
      const result = verifyCapsuleOffline(
        parsedCapsule,
        publicKeys(await jsonFile(argument(second))),
      );
      output(result);
      return result.valid ? EXIT.SUCCESS : EXIT.DATA;
    }
    if (
      command !== "scan" &&
      command !== "wait" &&
      command !== "status" &&
      command !== "inspect" &&
      command !== "policy" &&
      command !== "replay"
    )
      throw new CliUsageError();
    if (command === "wait") {
      if (argv.length < 2 || argv.length % 2 !== 0) throw new CliUsageError();
      waitFlags(argv);
    } else {
      exact(argv, 2);
    }
    const api = client(dependencies);
    if (command === "scan") {
      output(await api.scan((await jsonFile(argument(first))) as IngestionRequest));
      return EXIT.SUCCESS;
    }
    if (command === "wait") {
      const result = await api.wait(argument(first), {
        ...waitFlags(argv),
      });
      output(result);
      return stateExit(result.state);
    }
    if (command === "status") {
      const result = await api.status(argument(first));
      output(result);
      return stateExit(result.state);
    }
    if (command === "inspect") {
      const result = await api.inspect(argument(first));
      output(result);
      return stateExit(result.scan.state);
    }
    if (command === "policy") {
      const result = await api.policy(argument(first));
      output(result);
      return dispositionExit(result.disposition);
    }
    if (command === "replay") {
      output(await api.replay((await jsonFile(argument(first))) as IngestionRequest));
      return EXIT.SUCCESS;
    }
    throw new CliUsageError();
  } catch (error) {
    if (error instanceof CliUsageError) {
      output({ error: "CLI_USAGE", ...USAGE });
      return EXIT.USAGE;
    }
    if (error instanceof CliDataError) {
      output({ error: "CLI_INVALID_DATA" });
      return EXIT.DATA;
    }
    if (error instanceof VerusConfigurationError) {
      output({ error: "CLI_CONFIGURATION" });
      return EXIT.CONFIGURATION;
    }
    if (error instanceof VerusWaitTimeoutError) {
      output({ error: "SCAN_WAIT_TIMEOUT", scan_id: error.scanId });
      return EXIT.TIMEOUT;
    }
    if (error instanceof VerusApiError) {
      output({ error: error.code, status: error.status });
      if (error.status === 401 || error.status === 403) return EXIT.PERMISSION;
      if (error.retryable || error.status === 429) return EXIT.TEMPORARY;
      return EXIT.UNAVAILABLE;
    }
    output({ error: "CLI_FAILED" });
    return EXIT.SOFTWARE;
  }
}

export function isEntrypoint(moduleUrl: string, executablePath: string | undefined): boolean {
  if (!executablePath) return false;
  try {
    return fileURLToPath(moduleUrl) === resolve(executablePath);
  } catch {
    return false;
  }
}

if (isEntrypoint(import.meta.url, process.argv[1]))
  void run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
