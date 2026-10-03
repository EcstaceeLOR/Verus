import { setTimeout as delay } from "node:timers/promises";

import { Ed25519SigningProvider, SealedFileSecretProvider, SecretValue } from "@verus/crypto";
import { DeterministicRuleEngine, parseRuleSet } from "@verus/detection";
import { ScanProcessingService, SignedScanProcessingService } from "@verus/ingestion";
import { PostgresJobQueue } from "@verus/jobs";
import { StructuredLogger } from "@verus/observability";
import { Pool } from "pg";

import { parseWorkerRuntimeConfig, type WorkerRuntimeConfig } from "./config.js";
import { createSignedScanProcessHandler, runWorkerOnce } from "./index.js";

const POLL_INTERVAL_MS = 50;
const IDLE_INTERVAL_MS = 1_000;

export interface WorkerPollLoopInput {
  readonly runOnce: () => Promise<Readonly<{ claimed: boolean }>>;
  readonly logger: StructuredLogger;
  readonly signal: AbortSignal;
  readonly idleIntervalMs?: number;
  readonly pollIntervalMs?: number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  await delay(milliseconds, undefined, { signal });
}

/** Runs a bounded, cancellation-aware polling loop. Queue failures are logged and retried. */
export async function runWorkerPollLoop(input: WorkerPollLoopInput): Promise<void> {
  const idleIntervalMs = input.idleIntervalMs ?? IDLE_INTERVAL_MS;
  const pollIntervalMs = input.pollIntervalMs ?? POLL_INTERVAL_MS;
  if (!Number.isSafeInteger(idleIntervalMs) || idleIntervalMs < 1)
    throw new RangeError("Worker idle interval must be a positive integer.");
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1)
    throw new RangeError("Worker poll interval must be a positive integer.");
  const wait = input.wait ?? waitFor;
  while (!input.signal.aborted) {
    let claimed = false;
    try {
      claimed = (await input.runOnce()).claimed;
    } catch (error) {
      input.logger.error("worker.poll_failed", error, { component: "worker" });
    }
    if (input.signal.aborted) return;
    try {
      await wait(claimed ? pollIntervalMs : idleIntervalMs, input.signal);
    } catch (error) {
      if (isAbort(error)) return;
      throw error;
    }
  }
}

export interface ProductionWorkerRuntime {
  readonly run: (signal: AbortSignal) => Promise<void>;
  readonly close: () => Promise<void>;
}

/** Composes Verus's durable queue, detector, sealed signing provider, and scan processor. */
export function createProductionWorkerRuntime(
  config: WorkerRuntimeConfig,
  logger = new StructuredLogger("verus-worker"),
): ProductionWorkerRuntime {
  const masterKey = new SecretValue(Buffer.from(config.sealingMasterKey, "base64url"));
  const secrets = new SealedFileSecretProvider(config.secretsDirectory, masterKey);
  masterKey.destroy();
  const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  const queue = new PostgresJobQueue(pool);
  const detector = new DeterministicRuleEngine(parseRuleSet(config.ruleSet));
  const processing = new ScanProcessingService(pool, detector);
  const signedProcessing = new SignedScanProcessingService(
    processing,
    pool,
    new Ed25519SigningProvider(secrets),
    config.policyId,
  );
  const handler = createSignedScanProcessHandler(signedProcessing);
  let closed = false;

  return Object.freeze({
    run: async (signal: AbortSignal) => {
      await pool.query("SELECT 1");
      logger.emit({ level: "info", event: "worker.ready", component: "worker" });
      await runWorkerPollLoop({
        logger,
        signal,
        runOnce: () =>
          runWorkerOnce({
            queue,
            workspaceId: config.workspaceId,
            workerId: config.workerId,
            handler,
            logger,
          }),
      });
    },
    close: async () => {
      if (closed) return;
      closed = true;
      secrets.destroy();
      await pool.end();
    },
  });
}

/** Starts the worker executable and shuts every resource down on SIGINT or SIGTERM. */
export async function startWorkerProcess(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const logger = new StructuredLogger("verus-worker");
  const runtime = createProductionWorkerRuntime(parseWorkerRuntimeConfig(environment), logger);
  const controller = new AbortController();
  const shutdown = (signal: NodeJS.Signals): void => {
    logger.emit({
      level: "info",
      event: "worker.shutdown_requested",
      component: "worker",
      reasonCode: signal,
    });
    controller.abort();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    await runtime.run(controller.signal);
  } finally {
    await runtime.close();
  }
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  void startWorkerProcess().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Worker startup failed.";
    process.stderr.write(`Verus worker failed: ${message}\n`);
    process.exitCode = 1;
  });
}
