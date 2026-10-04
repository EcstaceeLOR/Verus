#!/usr/bin/env node
import { createServer, type Server } from "node:http";

import {
  hostHeaderValidation,
  localhostHostValidation,
  localhostOriginValidation,
  originValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { loadHttpRuntimeConfig } from "./config.js";
import { createApiMcpService, createVerusMcpServer, type ApiMcpServiceOptions } from "./index.js";

const MAX_MCP_BODY_BYTES = 1024 * 1024;

export interface McpHttpOptions {
  readonly apiBaseUrl: string;
  readonly host?: string;
  readonly port?: number;
  readonly allowedHosts?: readonly string[];
  readonly allowedOrigins?: readonly string[];
  readonly signingKeys?: ApiMcpServiceOptions["signingKeys"];
  readonly fetch?: typeof globalThis.fetch;
}

export function createVerusMcpHttpHandler(options: McpHttpOptions) {
  const handler = createMcpHandler(
    ({ authInfo }) => {
      if (!authInfo) throw new Error("Authenticated MCP request context is required.");
      return createVerusMcpServer(
        createApiMcpService({
          baseUrl: options.apiBaseUrl,
          apiKey: authInfo.token,
          workspaceId: authInfo.clientId,
          signingKeys: options.signingKeys ?? [],
          ...(options.fetch ? { fetch: options.fetch } : {}),
        }),
      );
    },
    {
      legacy: "stateless",
      maxRequestBodySize: MAX_MCP_BODY_BYTES,
    },
  );

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname !== "/mcp") return jsonResponse(404, { error: "NOT_FOUND" });
      const authorization = request.headers.get("authorization") ?? "";
      const workspaceId = request.headers.get("x-verus-workspace-id")?.trim() ?? "";
      const match = /^Bearer ([\x21-\x7e]{8,4096})$/.exec(authorization);
      const token = match?.[1];
      if (!token || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(workspaceId)) {
        return jsonResponse(401, { error: "AUTHENTICATION_REQUIRED" });
      }
      return handler.fetch(request, {
        authInfo: {
          token,
          clientId: workspaceId,
          scopes: ["scan.create", "scan.read", "capsule.read"],
        },
      });
    },
    close: handler.close,
  };
}

export function startMcpHttpServer(options: McpHttpOptions): Server {
  const host = options.host ?? "127.0.0.1";
  const allowedHosts = options.allowedHosts?.length ? [...options.allowedHosts] : undefined;
  const allowedOrigins = options.allowedOrigins?.length ? [...options.allowedOrigins] : undefined;
  const validateHost = allowedHosts
    ? hostHeaderValidation(allowedHosts)
    : localhostHostValidation();
  const validateOrigin = allowedOrigins
    ? originValidation(allowedOrigins)
    : localhostOriginValidation();
  const mcpHandler = createVerusMcpHttpHandler(options);
  const nodeHandler = toNodeHandler(mcpHandler, {
    maxRequestBodySize: MAX_MCP_BODY_BYTES,
    onerror: (error) =>
      process.stderr.write(`${JSON.stringify({ event: "mcp.http_error", name: error.name })}\n`),
  });
  const server = createServer(async (request, response) => {
    if (!validateHost(request, response) || !validateOrigin(request, response)) return;
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname === "/health" && request.method === "GET") {
      response.writeHead(200, { "cache-control": "no-store", "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ready", service: "verus-mcp", version: 1 }));
      return;
    }
    await nodeHandler(
      request as Parameters<typeof nodeHandler>[0],
      response as Parameters<typeof nodeHandler>[1],
    );
  });
  server.listen(options.port ?? 3100, host);
  server.once("close", () => void mcpHandler.close());
  return server;
}

function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  try {
    const config = loadHttpRuntimeConfig();
    const allowedHosts = process.env.VERUS_MCP_ALLOWED_HOSTS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const allowedOrigins = process.env.VERUS_MCP_ALLOWED_ORIGINS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const server = startMcpHttpServer({
      apiBaseUrl: config.baseUrl,
      host: process.env.VERUS_MCP_HOST ?? "127.0.0.1",
      port: Number(process.env.PORT ?? "3100"),
      signingKeys: config.signingKeys,
      ...(allowedHosts?.length ? { allowedHosts } : {}),
      ...(allowedOrigins?.length ? { allowedOrigins } : {}),
    });
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => server.close(() => process.exit(0)));
    }
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ event: "mcp.http_startup_failed", message: error instanceof Error ? error.message : "Invalid configuration." })}\n`,
    );
    process.exitCode = 78;
  }
}
