import type { DeterministicRuleEngine, DetectionFinding } from "./index.js";

export const REPRESENTATION_LIMITS = Object.freeze({
  maxDecodedBytes: 65536,
  maxFields: 32,
  maxInputBytes: 262144,
  maxTransformations: 64,
});
export type RepresentationKind = "canonical" | "normalized" | "base64" | "cross_field";
export interface ContentField {
  readonly id: string;
  readonly kind: "dom" | "metadata" | "attachment" | "link" | "text";
  readonly content: string;
}
export interface RepresentationFinding {
  readonly finding: DetectionFinding;
  readonly representation: Readonly<{ kind: RepresentationKind; content: string }>;
  readonly originalFieldIds: readonly string[];
}
export interface RepresentationVerdict {
  readonly findings: readonly RepresentationFinding[];
  readonly skippedTransforms: number;
}
function decode(value: string): string | undefined {
  if (
    value.length < 8 ||
    value.length > REPRESENTATION_LIMITS.maxDecodedBytes * 2 ||
    !/^[a-z0-9+/]+={0,2}$/iu.test(value)
  )
    return undefined;
  try {
    const bytes = Buffer.from(value, "base64");
    if (bytes.length === 0 || bytes.length > REPRESENTATION_LIMITS.maxDecodedBytes)
      return undefined;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return /[\p{L}\p{N}]/u.test(text) ? text : undefined;
  } catch {
    return undefined;
  }
}
function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export class RepresentationLayerDetector {
  readonly #engine: DeterministicRuleEngine;
  constructor(engine: DeterministicRuleEngine) {
    this.#engine = engine;
  }
  evaluate(
    input: Readonly<{ tenantId?: string; sourceId?: string; fields: readonly ContentField[] }>,
  ): Readonly<RepresentationVerdict> {
    if (input.fields.length > REPRESENTATION_LIMITS.maxFields)
      throw new RangeError("Too many representation fields.");
    let totalBytes = 0;
    let skippedTransforms = 0;
    const findings: RepresentationFinding[] = [];
    const inspect = (content: string, kind: RepresentationKind, ids: readonly string[]) => {
      totalBytes += Buffer.byteLength(content);
      if (totalBytes > REPRESENTATION_LIMITS.maxInputBytes)
        throw new RangeError("Representation input exceeds byte limit.");
      const context = {
        content,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      };
      for (const finding of this.#engine.evaluate(context).findings)
        findings.push(
          Object.freeze({
            finding,
            representation: Object.freeze({ kind, content }),
            originalFieldIds: Object.freeze([...ids]),
          }),
        );
    };
    for (const field of input.fields) {
      inspect(field.content, "canonical", [field.id]);
      const normalized = normalize(field.content);
      if (normalized !== field.content) inspect(normalized, "normalized", [field.id]);
      for (const token of (field.content.match(/[a-z0-9+/]{8,}={0,2}/giu) ?? []).slice(
        0,
        REPRESENTATION_LIMITS.maxTransformations,
      )) {
        const value = decode(token);
        if (value) inspect(value, "base64", [field.id]);
        else skippedTransforms += 1;
      }
    }
    if (input.fields.length)
      inspect(
        normalize(input.fields.map((field) => field.content).join(" ")),
        "cross_field",
        input.fields.map((field) => field.id),
      );
    return Object.freeze({ findings: Object.freeze(findings), skippedTransforms });
  }
}
