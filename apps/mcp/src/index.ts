import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import type { ContextCapsule, IngestionRequest } from "@verus/contracts";
import { toProblemDetails, VerusError } from "@verus/domain";
import { VerusClient } from "@verus/sdk";
import { z } from "zod/v4";

const identifier = z.string().min(3).max(128);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const httpsUrl = z.string().url().startsWith("https://").max(2048);
const textInput = z.object({
  kind: z.literal("text"),
  text: z.string().min(1).max(1_000_000),
  media_type: z.enum(["text/plain", "text/html", "application/xml", "application/json"]),
});
const urlInput = z.object({ kind: z.literal("url"), url: httpsUrl });
const uploadInput = z.object({
  kind: z.literal("upload"),
  upload_id: identifier,
  media_type: z.string().min(1).max(255),
  size_bytes: z.number().int().positive(),
  digest,
});
const feedInput = z.object({
  kind: z.literal("feed_event"),
  source_id: identifier,
  event_id: z.string().min(1).max(256),
  payload_digest: digest,
});

export const ingestionRequestSchema = z.object({
  schema_version: z.literal("1.0"),
  request_id: identifier,
  workspace_id: identifier,
  submitted_at: z.string().datetime(),
  idempotency_key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/),
  provenance: z.object({
    source_class: z.enum(["primary", "secondary", "user_supplied", "unknown"]),
    submitted_by: z.string().min(1).max(128),
    asserted_origin: httpsUrl.optional(),
  }),
  input: z.discriminatedUnion("kind", [textInput, urlInput, uploadInput, feedInput]),
  extensions: z.record(z.string(), z.unknown()),
});

const capsuleSchema = z.record(z.string(), z.unknown());
const rawContentKeys = new Set(["content", "raw_content", "parsed_text", "excerpt", "text"]);

export interface McpService {
  submit(request: IngestionRequest): Promise<unknown>;
  status(scanId: string): Promise<unknown>;
  capsule(scanId: string): Promise<unknown>;
  verify(capsule: ContextCapsule): Promise<unknown>;
}

export interface McpTelemetryEvent {
  readonly tool: "submit" | "status" | "capsule" | "verify";
  readonly outcome: "success" | "failure";
  readonly durationMs: number;
}

export interface McpServerOptions {
  readonly onTelemetry?: (event: McpTelemetryEvent) => void;
}

export interface ApiMcpServiceOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly workspaceId: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly retries?: number;
  readonly signingKeys?: Parameters<VerusClient["verifyOffline"]>[1];
}

export function createApiMcpService(options: ApiMcpServiceOptions): McpService {
  const client = new VerusClient(options);
  return Object.freeze({
    submit: (request: IngestionRequest) => {
      if (request.workspace_id !== options.workspaceId) {
        return Promise.reject(
          new VerusError("AUTHORIZATION_DENIED", "Request workspace does not match authorization."),
        );
      }
      return client.scan(request);
    },
    status: (scanId: string) => client.status(scanId),
    capsule: (scanId: string) => client.capsule(scanId),
    verify: (capsule: ContextCapsule) => client.verifyOffline(capsule, options.signingKeys ?? []),
  });
}

export function createVerusMcpServer(
  service: McpService,
  options: McpServerOptions = {},
): McpServer {
  const server = new McpServer(
    { name: "verus", version: "1.0.0" },
    { capabilities: { tools: { listChanged: false } } },
  );

  server.registerTool(
    "verus_submit",
    {
      title: "Submit context to Verus",
      description:
        "Submit untrusted context for Verus inspection. The response never includes submitted source content.",
      inputSchema: z.object({ request: ingestionRequestSchema }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ request }) =>
      runTool("submit", options, () => service.submit(request as IngestionRequest)),
  );

  server.registerTool(
    "verus_status",
    {
      title: "Inspect scan status",
      description:
        "Read the safe status and verdict metadata for a Verus scan. Source content is never returned.",
      inputSchema: z.object({ scan_id: identifier }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ scan_id }) => runTool("status", options, () => service.status(scan_id)),
  );

  server.registerTool(
    "verus_capsule",
    {
      title: "Retrieve Context Capsule",
      description:
        "Retrieve the signed, raw-content-free Context Capsule authorized for a completed Verus scan.",
      inputSchema: z.object({ scan_id: identifier }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ scan_id }) => runTool("capsule", options, () => service.capsule(scan_id)),
  );

  server.registerTool(
    "verus_verify",
    {
      title: "Verify Context Capsule",
      description:
        "Verify a Context Capsule signature with configured public keys. Verification does not access source content.",
      inputSchema: z.object({ capsule: capsuleSchema }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ capsule }) =>
      runTool("verify", options, () => service.verify(capsule as unknown as ContextCapsule)),
  );

  return server;
}

async function runTool(
  tool: McpTelemetryEvent["tool"],
  options: McpServerOptions,
  operation: () => Promise<unknown>,
): Promise<CallToolResult> {
  const started = performance.now();
  try {
    const value = sanitize(await operation());
    options.onTelemetry?.({ tool, outcome: "success", durationMs: performance.now() - started });
    return { content: [{ type: "text", text: stringify(value) }] };
  } catch (error) {
    options.onTelemetry?.({ tool, outcome: "failure", durationMs: performance.now() - started });
    return {
      isError: true,
      content: [{ type: "text", text: stringify(sanitize(toProblemDetails(error))) }],
    };
  }
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[depth-limited]";
  if (Array.isArray(value)) return value.slice(0, 1_000).map((child) => sanitize(child, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !rawContentKeys.has(key.toLowerCase()))
        .slice(0, 1_000)
        .map(([key, child]) => [key, sanitize(child, depth + 1)]),
    );
  }
  if (["string", "number", "boolean"].includes(typeof value) || value === null) return value;
  return String(value);
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "RESULT_SERIALIZATION_FAILED" });
  }
}
