import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EXIT, isEntrypoint, run } from "../src/cli.js";
import { signedCapsule } from "./fixtures.js";

const workspaceId = "ws_01ARZ3NDEKTSV4RRFFQ69G5FAW";
const scanId = "scan_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const env = {
  VERUS_API_KEY: "vrk.local-stack-secret",
  VERUS_WORKSPACE_ID: workspaceId,
};

describe("CLI local-stack examples", () => {
  let baseUrl = "";
  let directory = "";
  let capsulePath = "";
  let keysPath = "";
  let capsule: Awaited<ReturnType<typeof signedCapsule>>["capsule"];
  let ingestionCount = 0;

  const server = createServer((request, response) => {
    if (
      request.headers.authorization !== `Bearer ${env.VERUS_API_KEY}` ||
      request.headers["x-verus-workspace-id"] !== workspaceId
    ) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: "AUTHENTICATION_REQUIRED" }));
      return;
    }
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const send = (value: unknown, status = 200) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (request.method === "POST" && path === "/v1/ingestions") {
      ingestionCount += 1;
      request.resume();
      send(
        {
          data: {
            scan_id: scanId,
            state: "queued",
            idempotent_replay: ingestionCount > 1,
            correlation_id: "corr_local_stack",
          },
        },
        ingestionCount > 1 ? 200 : 202,
      );
      return;
    }
    if (path.endsWith("/findings")) {
      send({ data: capsule.findings });
      return;
    }
    if (path.endsWith("/evidence")) {
      send({ data: capsule.evidence });
      return;
    }
    if (path.endsWith("/capsule")) {
      send({ data: capsule });
      return;
    }
    if (path.includes("scan_review")) {
      send({ data: { scan_id: "scan_review", state: "review" } });
      return;
    }
    if (path.includes("scan_blocked")) {
      send({ data: { scan_id: "scan_blocked", state: "blocked" } });
      return;
    }
    if (path === `/v1/scans/${scanId}`) {
      send({
        data: {
          scan_id: scanId,
          request_id: "req_01ARZ3NDEKTSV4RRFFQ69G5FAV",
          input_digest: capsule.input_digest,
          state: "allowed",
          state_version: 3,
          created_at: capsule.created_at,
          updated_at: capsule.created_at,
        },
      });
      return;
    }
    send({ code: "NOT_FOUND" }, 404);
  });

  beforeAll(async () => {
    const signed = await signedCapsule("allow");
    capsule = signed.capsule;
    directory = await mkdtemp(join(tmpdir(), "verus-sdk-"));
    capsulePath = join(directory, "capsule.json");
    keysPath = join(directory, "public-keys.json");
    await Promise.all([
      writeFile(capsulePath, JSON.stringify(capsule), { mode: 0o600 }),
      writeFile(keysPath, JSON.stringify([signed.key]), { mode: 0o600 }),
    ]);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Local test server did not bind.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  });

  it("runs scan, wait, inspect, policy, and idempotent replay over HTTP", async () => {
    const output: unknown[] = [];
    const dependencies = { env: { ...env, VERUS_API_URL: baseUrl } };
    const requestPath = fileURLToPath(
      new URL("../../../docs/api/examples/ingestion-text.json", import.meta.url),
    );

    await expect(run(["scan", requestPath], output.push.bind(output), dependencies)).resolves.toBe(
      EXIT.SUCCESS,
    );
    await expect(
      run(
        ["wait", scanId, "--timeout-ms", "100", "--interval-ms", "1"],
        output.push.bind(output),
        dependencies,
      ),
    ).resolves.toBe(EXIT.SUCCESS);
    await expect(run(["inspect", scanId], output.push.bind(output), dependencies)).resolves.toBe(
      EXIT.SUCCESS,
    );
    await expect(run(["policy", scanId], output.push.bind(output), dependencies)).resolves.toBe(
      EXIT.SUCCESS,
    );
    await expect(
      run(["replay", requestPath], output.push.bind(output), dependencies),
    ).resolves.toBe(EXIT.SUCCESS);

    expect(JSON.stringify(output)).not.toContain(env.VERUS_API_KEY);
    expect(output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ idempotent_replay: false }),
        expect.objectContaining({ idempotent_replay: true }),
        expect.objectContaining({ disposition: "allow" }),
      ]),
    );
  }, 30_000);

  it("verifies a signed capsule offline without API configuration", async () => {
    const output: unknown[] = [];
    await expect(
      run(["verify", capsulePath, keysPath], output.push.bind(output), { env: {} }),
    ).resolves.toBe(EXIT.SUCCESS);
    expect(output).toEqual([expect.objectContaining({ valid: true })]);
  });

  it("uses documented semantic and usage exit codes", async () => {
    const dependencies = { env: { ...env, VERUS_API_URL: baseUrl } };
    await expect(run(["status", "scan_review"], () => undefined, dependencies)).resolves.toBe(
      EXIT.REVIEW,
    );
    await expect(run(["status", "scan_blocked"], () => undefined, dependencies)).resolves.toBe(
      EXIT.BLOCKED,
    );
    await expect(run([], () => undefined, dependencies)).resolves.toBe(EXIT.USAGE);
  });

  it("recognizes its executable path across filesystem and URL representations", () => {
    expect(isEntrypoint(import.meta.url, fileURLToPath(import.meta.url))).toBe(true);
    expect(isEntrypoint(import.meta.url, undefined)).toBe(false);
    expect(isEntrypoint("not-a-url", fileURLToPath(import.meta.url))).toBe(false);
  });
});
