#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { VerusApiError, VerusClient } from "./index.js";

type Output = (value: unknown) => void;
function required(name: "VERUS_API_URL" | "VERUS_API_KEY" | "VERUS_WORKSPACE_ID"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
export async function run(
  argv: readonly string[],
  output: Output = (value) => process.stdout.write(`${JSON.stringify(value)}\n`),
): Promise<number> {
  try {
    const client = new VerusClient({
      baseUrl: required("VERUS_API_URL"),
      apiKey: required("VERUS_API_KEY"),
      workspaceId: required("VERUS_WORKSPACE_ID"),
    });
    const [command, argument] = argv;
    if (command === "scan") {
      output(await client.scan(JSON.parse(await readFile(argument ?? "", "utf8")) as unknown));
      return 0;
    }
    if (command === "status") {
      output(await client.status(argument ?? ""));
      return 0;
    }
    if (command === "inspect") {
      output(await client.scans());
      return 0;
    }
    if (command === "capsule") {
      output(await client.capsule(argument ?? ""));
      return 0;
    }
    if (command === "verify") {
      output({ error: "Offline key discovery must be supplied by the host integration." });
      return 64;
    }
    output({
      error: "Usage: verus scan <request.json>|status <scan-id>|inspect|capsule <scan-id>|verify",
    });
    return 64;
  } catch (error) {
    if (error instanceof VerusApiError) {
      output({ error: error.code, status: error.status });
      return error.status === 401 || error.status === 403 ? 77 : 1;
    }
    output({ error: "CLI_FAILED" });
    return 1;
  }
}
if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href)
  void run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
