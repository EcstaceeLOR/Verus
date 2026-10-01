import { createHash } from "node:crypto";

import { SafeMetricRegistry, StructuredLogger } from "@verus/observability";

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/u;
const BIDI_CONTROL = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
const HOMOGLYPHS = new Map<string, string>([
  ["\u0430", "a"],
  ["\u0435", "e"],
  ["\u043E", "o"],
  ["\u0440", "p"],
  ["\u0441", "c"],
  ["\u0445", "x"],
  ["\u0443", "y"],
  ["\u0410", "A"],
  ["\u0412", "B"],
  ["\u0415", "E"],
  ["\u041A", "K"],
  ["\u041C", "M"],
  ["\u041D", "H"],
  ["\u041E", "O"],
  ["\u0420", "P"],
  ["\u0421", "C"],
  ["\u0422", "T"],
  ["\u0425", "X"],
  ["\u0423", "Y"],
]);

export type CanonicalFindingKind =
  | "bidirectional_control"
  | "control_character"
  | "css_hidden"
  | "homoglyph"
  | "metadata_payload"
  | "unicode_normalized"
  | "visual_text_disagreement"
  | "zero_width";
export interface CanonicalFinding {
  readonly kind: CanonicalFindingKind;
  readonly sourceEnd: number;
  readonly sourceStart: number;
}
export interface TransformationMapEntry {
  readonly canonicalEnd: number;
  readonly canonicalStart: number;
  readonly kind: CanonicalFindingKind;
  readonly sourceEnd: number;
  readonly sourceStart: number;
}
export interface CanonicalizedContent {
  readonly canonical: Readonly<{ content: string; digest: string }>;
  readonly findings: readonly CanonicalFinding[];
  readonly raw: Readonly<{ digest: string }>;
  readonly transformationMap: readonly TransformationMapEntry[];
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
function sourceBytes(input: string | Uint8Array): Uint8Array {
  return typeof input === "string" ? Buffer.from(input, "utf8") : input;
}
function decode(input: string | Uint8Array, encoding: "utf-16le" | "utf-8" = "utf-8"): string {
  if (typeof input === "string") return input;
  return new TextDecoder(encoding, { fatal: true }).decode(input);
}
function isNonPrintingControl(value: string): boolean {
  const codePoint = value.codePointAt(0);
  if (codePoint === undefined) return false;
  return (
    codePoint <= 0x08 ||
    (codePoint >= 0x0b && codePoint <= 0x0c) ||
    (codePoint >= 0x0e && codePoint <= 0x1f) ||
    (codePoint >= 0x7f && codePoint <= 0x9f)
  );
}
function pushFinding(
  findings: CanonicalFinding[],
  maps: TransformationMapEntry[],
  kind: CanonicalFindingKind,
  sourceStart: number,
  sourceEnd: number,
  canonicalStart: number,
  canonicalEnd: number,
): void {
  findings.push({ kind, sourceEnd, sourceStart });
  maps.push({ canonicalEnd, canonicalStart, kind, sourceEnd, sourceStart });
}

/**
 * Applies the v1 text policy: UTF decoding, NFKC, removal of invisible/control
 * formatting, and preservation of every non-lossless change as a source-mapped finding.
 */
export function canonicalizeUntrustedContent(
  input: Readonly<{
    bytes: string | Uint8Array;
    encoding?: "utf-16le" | "utf-8";
    hiddenRegions?: readonly Readonly<{
      location?: Readonly<{ endOffset: number; startOffset: number }>;
      reason: string;
    }>[];
    metadata?: Readonly<Record<string, string>>;
    visualText?: string;
  }>,
): CanonicalizedContent {
  const rawBytes = sourceBytes(input.bytes);
  const rawText = decode(input.bytes, input.encoding);
  const findings: CanonicalFinding[] = [];
  const transformationMap: TransformationMapEntry[] = [];
  const output: string[] = [];
  let canonicalOffset = 0;
  for (let index = 0; index < rawText.length;) {
    const codePoint = rawText.codePointAt(index);
    if (codePoint === undefined) break;
    const original = String.fromCodePoint(codePoint);
    const sourceStart = index;
    index += original.length;
    const sourceEnd = index;
    if (ZERO_WIDTH.test(original)) {
      pushFinding(
        findings,
        transformationMap,
        "zero_width",
        sourceStart,
        sourceEnd,
        canonicalOffset,
        canonicalOffset,
      );
      continue;
    }
    if (BIDI_CONTROL.test(original)) {
      pushFinding(
        findings,
        transformationMap,
        "bidirectional_control",
        sourceStart,
        sourceEnd,
        canonicalOffset,
        canonicalOffset,
      );
      continue;
    }
    if (isNonPrintingControl(original)) {
      pushFinding(
        findings,
        transformationMap,
        "control_character",
        sourceStart,
        sourceEnd,
        canonicalOffset,
        canonicalOffset,
      );
      continue;
    }
    const skeleton = HOMOGLYPHS.get(original);
    const normalized = skeleton ?? original.normalize("NFKC");
    if (normalized !== original)
      pushFinding(
        findings,
        transformationMap,
        "unicode_normalized",
        sourceStart,
        sourceEnd,
        canonicalOffset,
        canonicalOffset + normalized.length,
      );
    if (skeleton !== undefined)
      pushFinding(
        findings,
        transformationMap,
        "homoglyph",
        sourceStart,
        sourceEnd,
        canonicalOffset,
        canonicalOffset + normalized.length,
      );
    output.push(normalized);
    canonicalOffset += normalized.length;
  }
  const canonicalText = output.join("").normalize("NFKC");
  for (const region of input.hiddenRegions ?? []) {
    if (region.reason !== "hidden_css") continue;
    pushFinding(
      findings,
      transformationMap,
      "css_hidden",
      region.location?.startOffset ?? 0,
      region.location?.endOffset ?? 0,
      0,
      0,
    );
  }
  for (const value of Object.values(input.metadata ?? {})) {
    if (value.trim() === "") continue;
    pushFinding(findings, transformationMap, "metadata_payload", 0, 0, 0, 0);
  }
  if (input.visualText !== undefined && input.visualText.normalize("NFKC") !== canonicalText) {
    pushFinding(
      findings,
      transformationMap,
      "visual_text_disagreement",
      0,
      rawText.length,
      0,
      canonicalText.length,
    );
  }
  return Object.freeze({
    canonical: Object.freeze({
      content: canonicalText,
      digest: sha256(Buffer.from(canonicalText, "utf8")),
    }),
    findings: Object.freeze(findings),
    raw: Object.freeze({ digest: sha256(rawBytes) }),
    transformationMap: Object.freeze(transformationMap),
  });
}

export function createCanonicalizer(
  options: Readonly<{ logger?: StructuredLogger; metrics?: SafeMetricRegistry }> = {},
): Readonly<{ canonicalize: typeof canonicalizeUntrustedContent }> {
  const logger = options.logger ?? new StructuredLogger("verus-parser");
  const metrics = options.metrics ?? new SafeMetricRegistry();
  return Object.freeze({
    canonicalize(input) {
      const startedAt = performance.now();
      try {
        const result = canonicalizeUntrustedContent(input);
        const durationMs = performance.now() - startedAt;
        metrics.observe(
          "verus_scan_duration_ms",
          { outcome: "success", stage: "parser" },
          durationMs,
        );
        logger.emit({
          component: "parser",
          durationMs,
          event: "content.canonicalized",
          level: "info",
          outcome: "success",
        });
        return result;
      } catch (error) {
        const durationMs = performance.now() - startedAt;
        metrics.increment("verus_failures_total", {
          component: "parser",
          error_code: "CANONICALIZATION_FAILED",
        });
        metrics.observe(
          "verus_scan_duration_ms",
          { outcome: "failure", stage: "parser" },
          durationMs,
        );
        logger.emit({
          component: "parser",
          durationMs,
          errorCode: "CANONICALIZATION_FAILED",
          event: "content.canonicalization_failed",
          level: "warn",
          outcome: "failure",
        });
        throw error;
      }
    },
  });
}
