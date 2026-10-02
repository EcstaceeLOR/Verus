import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import { VerusError, toProblemDetails } from "@verus/domain";

export interface McpAuthorization {
  readonly workspaceId: string;
  readonly token: string;
}
export interface McpService {
  submit(input: Readonly<{ authorization: McpAuthorization; request: unknown }>): Promise<unknown>;
  status(input: Readonly<{ authorization: McpAuthorization; scanId: string }>): Promise<unknown>;
  capsule(input: Readonly<{ authorization: McpAuthorization; scanId: string }>): Promise<unknown>;
  verify(input: Readonly<{ authorization: McpAuthorization; capsule: unknown }>): Promise<unknown>;
}
export type McpRequest = Readonly<{
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}>;
const tools = Object.freeze([
  {
    name: "verus_submit",
    description: "Submit a scan request through Verus policy and authorization checks.",
  },
  {
    name: "verus_status",
    description: "Read the safe status of a Verus scan; source content is never returned.",
  },
  {
    name: "verus_capsule",
    description: "Retrieve a signed Context Capsule for a scan after authorization.",
  },
  {
    name: "verus_verify",
    description: "Verify a Context Capsule signature without accessing source content.",
  },
]);
function auth(value: unknown): McpAuthorization {
  const input = value as { authorization?: McpAuthorization };
  if (!input?.authorization?.workspaceId || !input.authorization.token)
    throw new VerusError("AUTHENTICATION_REQUIRED", "MCP authorization is required.");
  return input.authorization;
}
function safe(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !["content", "raw_content", "parsed_text", "excerpt"].includes(key))
        .map(([key, child]) => [key, safe(child)]),
    );
  return value;
}
function text(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(safe(value)) }] };
}
export function createMcpServer(service: McpService) {
  return async (request: McpRequest): Promise<unknown> => {
    try {
      if (request.jsonrpc !== "2.0")
        throw new VerusError("CONTRACT_VALIDATION_FAILED", "MCP uses JSON-RPC 2.0.");
      if (request.method === "initialize")
        return {
          protocolVersion: "2025-06-18",
          serverInfo: { name: "verus", version: "1.0.0" },
          capabilities: { tools: {} },
        };
      if (request.method === "tools/list") return { tools };
      if (request.method !== "tools/call")
        throw new VerusError("NOT_FOUND", "MCP method is unavailable.");
      const params = request.params as { name?: string; arguments?: Record<string, unknown> };
      const authorization = auth(params.arguments);
      const args = params.arguments ?? {};
      if (params.name === "verus_submit")
        return text(await service.submit({ authorization, request: args.request }));
      if (params.name === "verus_status")
        return text(await service.status({ authorization, scanId: String(args.scan_id ?? "") }));
      if (params.name === "verus_capsule")
        return text(await service.capsule({ authorization, scanId: String(args.scan_id ?? "") }));
      if (params.name === "verus_verify")
        return text(await service.verify({ authorization, capsule: args.capsule }));
      throw new VerusError("NOT_FOUND", "MCP tool is unavailable.");
    } catch (error) {
      return { isError: true, ...text(toProblemDetails(error)) };
    }
  };
}
/** Newline-delimited JSON-RPC stdio transport for local agent hosts. */
export function runStdio(
  server: ReturnType<typeof createMcpServer>,
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): void {
  createInterface({ input, crlfDelay: Infinity }).on("line", (line) => {
    void Promise.resolve().then(async () =>
      output.write(`${JSON.stringify(await server(JSON.parse(line) as McpRequest))}\n`),
    );
  });
}
