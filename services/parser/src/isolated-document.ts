import { Worker } from "node:worker_threads";

import { SafeMetricRegistry, StructuredLogger } from "@verus/observability";

import { DOCUMENT_LIMITS, type DocumentExtraction, DocumentParseFailure } from "./document.js";

const WORKER_MEMORY_MB = 256;

/**
 * Production boundary for document parsing. The worker receives only bytes and a
 * declared content type; it has no network, credential, database, or object-store capability.
 */
export function createIsolatedDocumentParser(
  options: Readonly<{ logger?: StructuredLogger; metrics?: SafeMetricRegistry }> = {},
): Readonly<{
  extract(input: Readonly<{ bytes: Uint8Array; contentType: string }>): Promise<DocumentExtraction>;
}> {
  const logger = options.logger ?? new StructuredLogger("verus-parser");
  const metrics = options.metrics ?? new SafeMetricRegistry();
  return Object.freeze({
    async extract(input) {
      if (input.bytes.byteLength > DOCUMENT_LIMITS.maxBytes)
        throw new DocumentParseFailure("DOCUMENT_LIMIT", "Document exceeds extraction byte limit.");
      const startedAt = performance.now();
      const worker = new Worker(new URL("./document-worker.js", import.meta.url), {
        // Do not inherit loader/debug flags that could alter the isolation boundary.
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: WORKER_MEMORY_MB, maxYoungGenerationSizeMb: 32 },
      });
      try {
        const result = await new Promise<DocumentExtraction>((resolve, reject) => {
          const timer = setTimeout(() => {
            void worker.terminate();
            reject(new Error("Isolated document parser timeout."));
          }, DOCUMENT_LIMITS.timeoutMs);
          worker.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          worker.once(
            "message",
            (
              message: Readonly<{
                error?: Readonly<{ code: string; message: string }>;
                result?: DocumentExtraction;
              }>,
            ) => {
              clearTimeout(timer);
              if (message.result !== undefined) resolve(message.result);
              else reject(new Error(message.error?.message ?? "Document parser failed safely."));
            },
          );
          worker.postMessage({ bytes: input.bytes, contentType: input.contentType });
        });
        const durationMs = performance.now() - startedAt;
        metrics.observe(
          "verus_scan_duration_ms",
          { outcome: result.complete ? "success" : "failure", stage: "parser" },
          durationMs,
        );
        logger.emit({
          component: "parser",
          durationMs,
          event: "document.extracted",
          level: result.complete ? "info" : "warn",
          outcome: result.complete ? "success" : "failure",
        });
        return result;
      } catch {
        const durationMs = performance.now() - startedAt;
        metrics.increment("verus_failures_total", {
          component: "parser",
          error_code: "DOCUMENT_PARSE_FAILED",
        });
        metrics.observe(
          "verus_scan_duration_ms",
          { outcome: "failure", stage: "parser" },
          durationMs,
        );
        logger.emit({
          component: "parser",
          durationMs,
          errorCode: "DOCUMENT_PARSE_FAILED",
          event: "document.parse_failed",
          level: "warn",
          outcome: "failure",
        });
        return Object.freeze({
          complete: false,
          format: "pdf",
          problems: Object.freeze([
            { code: "DOCUMENT_PARSE_FAILED", message: "Document extraction failed safely." },
          ]),
          text: Object.freeze([]),
        });
      } finally {
        await worker.terminate();
      }
    },
  });
}
