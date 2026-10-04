import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it, vi } from "vitest";

import scanFixture from "../../../contracts/v1/fixtures/valid/interface-scan-record.json" with { type: "json" };
import { run as runCli } from "../../../packages/sdk/src/cli.js";
import { VerusClient } from "../../../packages/sdk/src/index.js";
import { createPublicApiHandler } from "../../api/src/public-api.js";
import { loadHttpRuntimeConfig, loadRuntimeConfig } from "../src/config.js";
import { createVerusMcpHttpHandler } from "../src/http.js";
import { createApiMcpService, createVerusMcpServer, type McpService } from "../src/index.js";

const services: McpService[] = [];
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  services.splice(0);
});

function fakeService(): McpService {
  const service: McpService = {
    submit: vi.fn(async () => ({ scan_id: "scan_1", state: "accepted" })),
    status: vi.fn(async () => ({ state: "review", raw_content: "must never escape" })),
    capsule: vi.fn(async () => ({ capsule_id: "cap_1" })),
    verify: vi.fn(async () => ({ valid: true })),
  };
  services.push(service);
  return service;
}

async function inMemoryClient(service = fakeService()) {
  const server = createVerusMcpServer(service);
  const client = new Client({ name: "verus-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

describe("Verus MCP server", () => {
  it("publishes a fixed, credential-free tool profile through the official client", async () => {
    const client = await inMemoryClient();
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "verus_submit",
      "verus_status",
      "verus_capsule",
      "verus_verify",
    ]);
    expect(JSON.stringify(listed)).not.toMatch(/authorization|api[_ -]?key|token/i);
    expect(listed.tools.every((tool) => tool.inputSchema.type === "object")).toBe(true);
  });

  it("applies schemas and removes hostile source fields from responses", async () => {
    const client = await inMemoryClient();
    const result = await client.callTool({
      name: "verus_status",
      arguments: { scan_id: "scan_1" },
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain("review");
    expect(JSON.stringify(result.content)).not.toContain("must never escape");
    const invalid = await client.callTool({
      name: "verus_status",
      arguments: { scan_id: "" },
    });
    expect(invalid.isError).toBe(true);
  });

  it("records bounded telemetry without arguments or credentials", async () => {
    const events: unknown[] = [];
    const server = createVerusMcpServer(fakeService(), {
      onTelemetry: (event) => events.push(event),
    });
    const client = new Client({ name: "telemetry-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closers.push(async () => {
      await client.close();
      await server.close();
    });
    await client.callTool({ name: "verus_capsule", arguments: { scan_id: "scan_1" } });
    expect(events).toMatchObject([{ tool: "capsule", outcome: "success" }]);
    expect(JSON.stringify(events)).not.toContain("scan_1");
  });
});

describe("shared public-interface conformance", () => {
  it("returns one semantic scan artifact through REST, SDK, CLI, and MCP", async () => {
    const handler = createPublicApiHandler({
      authenticator: {
        authenticate: async () => ({
          keyId: "key_conformance",
          scopes: ["scan.read"],
          workspaceId: "ws_conformance",
        }),
      },
      data: {
        getCapsule: async () => undefined,
        getEvidence: async () => undefined,
        getFindings: async () => undefined,
        getScan: async () => ({ ...scanFixture, raw_content: "must never cross an interface" }),
        listScans: async () => ({ items: [scanFixture] }),
      },
      limiter: { check: async () => ({ allowed: true }) },
    });
    const apiFetch: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const request = Object.assign(new PassThrough(), {
        headers: Object.fromEntries(new Headers(init?.headers)),
        method: init?.method ?? "GET",
        url: `${url.pathname}${url.search}`,
      }) as unknown as IncomingMessage;
      const chunks: Buffer[] = [];
      const responseHeaders = new Headers();
      const response = {
        end: (body: string) => chunks.push(Buffer.from(body)),
        setHeader: (name: string, value: string) => responseHeaders.set(name, value),
        statusCode: 0,
        writeHead: (status: number, headers?: Record<string, string>) => {
          response.statusCode = status;
          for (const [name, value] of Object.entries(headers ?? {}))
            responseHeaders.set(name, value);
        },
      } as unknown as ServerResponse & { statusCode: number };
      await handler(request, response, {
        correlationId: "corr_conformance",
        spanId: "span_conformance",
        traceFlags: "01",
        traceId: "trace_conformance",
      });
      return new Response(Buffer.concat(chunks), {
        headers: responseHeaders,
        status: response.statusCode,
      });
    };
    const base = {
      apiKey: "conformance-secret",
      baseUrl: "https://api.verus.test",
      fetch: apiFetch,
      workspaceId: "ws_conformance",
    };

    const restEnvelope = (await (
      await apiFetch(`https://api.verus.test/v1/scans/${scanFixture.scan_id}`)
    ).json()) as { data: unknown };
    const sdk = await new VerusClient(base).status(scanFixture.scan_id);
    const cliOutput: unknown[] = [];
    const cliExit = await runCli(
      ["status", scanFixture.scan_id],
      (value) => cliOutput.push(value),
      {
        env: {
          VERUS_API_KEY: base.apiKey,
          VERUS_API_URL: base.baseUrl,
          VERUS_WORKSPACE_ID: base.workspaceId,
        },
        fetch: apiFetch,
      },
    );
    const client = await inMemoryClient(createApiMcpService(base));
    const mcpResult = await client.callTool({
      arguments: { scan_id: scanFixture.scan_id },
      name: "verus_status",
    });
    const content = mcpResult.content[0];
    if (content?.type !== "text") throw new Error("MCP did not return a text artifact.");
    const mcp = JSON.parse(content.text) as unknown;

    expect(cliExit).toBe(2);
    expect([restEnvelope.data, sdk, cliOutput[0], mcp]).toEqual([
      scanFixture,
      scanFixture,
      scanFixture,
      scanFixture,
    ]);
    expect(JSON.stringify([restEnvelope.data, sdk, cliOutput[0], mcp])).not.toContain("must never");
  });
});

describe("hosted Streamable HTTP transport", () => {
  it("requires transport credentials before MCP negotiation", async () => {
    const handler = createVerusMcpHttpHandler({ apiBaseUrl: "https://api.verus.test" });
    closers.push(handler.close);
    const response = await handler.fetch(
      new Request("https://mcp.verus.test/mcp", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "AUTHENTICATION_REQUIRED" });
  });

  it("works with the official Streamable HTTP client and forwards REST authorization", async () => {
    const apiFetch = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-token");
      expect(headers.get("x-verus-workspace-id")).toBe("ws_test");
      return Response.json({ data: { scan_id: "scan_1", state: "review" } });
    });
    const handler = createVerusMcpHttpHandler({
      apiBaseUrl: "https://api.verus.test",
      fetch: apiFetch,
    });
    closers.push(handler.close);
    const transport = new StreamableHTTPClientTransport(new URL("https://mcp.verus.test/mcp"), {
      authProvider: { token: async () => "test-token" },
      requestInit: { headers: { "x-verus-workspace-id": "ws_test" } },
      fetch: (input, init) => handler.fetch(new Request(input, init)),
    });
    const client = new Client({ name: "http-compatibility-test", version: "1.0.0" });
    await client.connect(transport);
    closers.push(() => client.close());
    expect((await client.listTools()).tools).toHaveLength(4);
    const result = await client.callTool({
      name: "verus_status",
      arguments: { scan_id: "scan_1" },
    });
    expect(JSON.stringify(result.content)).toContain("review");
    expect(apiFetch).toHaveBeenCalledOnce();
  });
});

describe("stdio executable compatibility", () => {
  it("is spawned and called by the official stdio client", async () => {
    const api = createServer((request, response) => {
      expect(request.headers.authorization).toBe("Bearer stdio-token");
      expect(request.headers["x-verus-workspace-id"]).toBe("ws_stdio");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: { state: "allowed", scan_id: "scan_stdio" } }));
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    closers.push(
      () =>
        new Promise<void>((resolve, reject) =>
          api.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const address = api.address();
    if (address === null || typeof address === "string")
      throw new Error("Test API did not bind TCP.");

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        fileURLToPath(import.meta.resolve("tsx/cli")),
        fileURLToPath(new URL("../src/stdio.ts", import.meta.url)),
      ],
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...getDefaultEnvironment(),
        VERUS_API_URL: `http://127.0.0.1:${address.port}`,
        VERUS_API_KEY: "stdio-token",
        VERUS_WORKSPACE_ID: "ws_stdio",
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-compatibility-test", version: "1.0.0" });
    await client.connect(transport);
    closers.unshift(() => client.close());
    const result = await client.callTool({
      name: "verus_status",
      arguments: { scan_id: "scan_stdio" },
    });
    expect(JSON.stringify(result.content)).toContain("allowed");
  }, 30_000);
});

describe("API service and configuration", () => {
  it("passes REST authorization through the typed SDK", async () => {
    const apiFetch = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer api-secret");
      expect(headers.get("x-verus-workspace-id")).toBe("ws_1");
      return Response.json({ data: { state: "allowed" } });
    });
    const service = createApiMcpService({
      baseUrl: "https://api.verus.test",
      apiKey: "api-secret",
      workspaceId: "ws_1",
      fetch: apiFetch,
    });
    await expect(service.status("scan_1")).resolves.toEqual({ state: "allowed" });
    await expect(service.submit({ workspace_id: "ws_other" } as never)).rejects.toThrow(
      "does not match authorization",
    );
    expect(apiFetch).toHaveBeenCalledOnce();
  });

  it("fails closed on missing or insecure runtime configuration", () => {
    expect(() => loadRuntimeConfig({})).toThrow("VERUS_API_URL is required");
    expect(() =>
      loadRuntimeConfig({
        VERUS_API_URL: "http://api.example.test",
        VERUS_API_KEY: "secret",
        VERUS_WORKSPACE_ID: "ws_1",
      }),
    ).toThrow("must use HTTPS");
    expect(loadHttpRuntimeConfig({ VERUS_API_URL: "https://api.example.test" })).toMatchObject({
      baseUrl: "https://api.example.test/",
      signingKeys: [],
    });
  });
});
