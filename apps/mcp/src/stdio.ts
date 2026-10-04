#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { loadRuntimeConfig } from "./config.js";
import { createApiMcpService, createVerusMcpServer } from "./index.js";

try {
  const config = loadRuntimeConfig();
  const service = createApiMcpService(config);
  const handle = serveStdio(
    () =>
      createVerusMcpServer(service, {
        onTelemetry: (event) =>
          process.stderr.write(`${JSON.stringify({ event: "mcp.tool", ...event })}\n`),
      }),
    {
      onerror: (error) =>
        process.stderr.write(`${JSON.stringify({ event: "mcp.error", name: error.name })}\n`),
      maxSubscriptions: 32,
    },
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void handle.close().finally(() => process.exit(0)));
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ event: "mcp.startup_failed", message: error instanceof Error ? error.message : "Invalid configuration." })}\n`,
  );
  process.exitCode = 78;
}
