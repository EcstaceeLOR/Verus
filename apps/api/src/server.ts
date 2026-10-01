import { createServer } from "node:http";

import { healthPayload, parsePort } from "./health.js";

const host = process.env.VERUS_API_HOST ?? "127.0.0.1";
const port = parsePort(process.env.VERUS_API_PORT ?? "3001");

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
  if (request.method === "GET" && ["/health/live", "/health/ready"].includes(requestUrl.pathname)) {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(healthPayload));
    return;
  }

  response.writeHead(404, { "content-type": "application/problem+json; charset=utf-8" });
  response.end(
    JSON.stringify({
      type: "https://verus.security/problems/not-found",
      title: "Not found",
      status: 404,
    }),
  );
});

server.listen(port, host, () => {
  process.stdout.write(
    `${JSON.stringify({ level: "info", service: "verus-api", event: "listening", host, port })}\n`,
  );
});

function shutdown(signal: NodeJS.Signals): void {
  server.close((error) => {
    if (error) {
      process.stderr.write(
        `${JSON.stringify({ level: "error", event: "shutdown_failed", signal })}\n`,
      );
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
