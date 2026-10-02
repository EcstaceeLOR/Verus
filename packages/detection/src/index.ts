import { createHash } from "node:crypto";

export * from "./representation.js";

export const DETECTOR_RULESET_SCHEMA_VERSION = "1.0" as const;
export type DetectionDisposition = "allow" | "review" | "block";
export type DetectionSeverity = "low" | "medium" | "high" | "critical";
export type RuleReasonCode =
  | "DIRECT_INSTRUCTION_OVERRIDE"
  | "INDIRECT_INSTRUCTION_OVERRIDE"
  | "TOOL_COERCION"
  | "SOURCE_IMPERSONATION";

export interface DetectorRule {
  readonly id: string;
  readonly reasonCode: RuleReasonCode;
  readonly version: string;
  readonly phrase: string;
  readonly severity: DetectionSeverity;
  readonly disposition: DetectionDisposition;
  readonly scope?: Readonly<{ tenantIds?: readonly string[]; sourceIds?: readonly string[] }>;
}
export interface DetectorRuleSet {
  readonly schemaVersion: typeof DETECTOR_RULESET_SCHEMA_VERSION;
  readonly version: string;
  readonly rules: readonly DetectorRule[];
}
export interface DetectionLocation {
  readonly start: Readonly<{ offset: number; line: number; column: number }>;
  readonly end: Readonly<{ offset: number; line: number; column: number }>;
}
export interface DetectionFinding {
  readonly ruleId: string;
  readonly reasonCode: RuleReasonCode;
  readonly severity: DetectionSeverity;
  readonly disposition: DetectionDisposition;
  readonly location: DetectionLocation;
}
export interface DetectionVerdict {
  readonly disposition: DetectionDisposition;
  readonly findings: readonly DetectionFinding[];
  readonly ruleSetDigest: string;
  readonly ruleSetVersion: string;
}
export interface DetectionTelemetry {
  record(
    event: Readonly<{
      outcome: "allow" | "review" | "block";
      findingCount: number;
      ruleSetDigest: string;
    }>,
  ): void;
}

const allowedReasonCodes = new Set<RuleReasonCode>([
  "DIRECT_INSTRUCTION_OVERRIDE",
  "INDIRECT_INSTRUCTION_OVERRIDE",
  "TOOL_COERCION",
  "SOURCE_IMPERSONATION",
]);
const allowedSeverities = new Set<DetectionSeverity>(["low", "medium", "high", "critical"]);
const allowedDispositions = new Set<DetectionDisposition>(["allow", "review", "block"]);
const dispositionRank: Record<DetectionDisposition, number> = { allow: 0, review: 1, block: 2 };

export class DetectorConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DetectorConfigurationError";
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function location(content: string, start: number, length: number): DetectionLocation {
  const point = (offset: number) => {
    const prefix = content.slice(0, offset);
    const line = prefix.split("\n").length;
    return Object.freeze({ offset, line, column: offset - prefix.lastIndexOf("\n") });
  };
  return Object.freeze({ start: point(start), end: point(start + length) });
}
function applies(rule: DetectorRule, tenantId?: string, sourceId?: string): boolean {
  const scope = rule.scope;
  return !(
    (scope?.tenantIds && (!tenantId || !scope.tenantIds.includes(tenantId))) ||
    (scope?.sourceIds && (!sourceId || !scope.sourceIds.includes(sourceId)))
  );
}

export function validateRuleSet(input: unknown): Readonly<DetectorRuleSet> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DetectorConfigurationError("Rule set must be an object.");
  const value = input as Record<string, unknown>;
  if (
    value.schemaVersion !== DETECTOR_RULESET_SCHEMA_VERSION ||
    typeof value.version !== "string" ||
    !Array.isArray(value.rules)
  ) {
    throw new DetectorConfigurationError("Rule set has an unsupported schema or shape.");
  }
  const ids = new Set<string>();
  const rules = value.rules.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw new DetectorConfigurationError("Rule must be an object.");
    const rule = candidate as Record<string, unknown>;
    if (
      typeof rule.id !== "string" ||
      !/^[a-z0-9-]+$/u.test(rule.id) ||
      !ids.add(rule.id) ||
      typeof rule.version !== "string" ||
      typeof rule.phrase !== "string" ||
      rule.phrase.trim().length < 3 ||
      !allowedReasonCodes.has(rule.reasonCode as RuleReasonCode) ||
      !allowedSeverities.has(rule.severity as DetectionSeverity) ||
      !allowedDispositions.has(rule.disposition as DetectionDisposition)
    )
      throw new DetectorConfigurationError("Rule contains invalid values.");
    if (
      rule.phrase.includes("${") ||
      rule.phrase.includes("=>") ||
      rule.phrase.includes("function")
    ) {
      throw new DetectorConfigurationError(
        "Rules support literal phrases only; expressions are forbidden.",
      );
    }
    const scope = rule.scope as Record<string, unknown> | undefined;
    for (const list of [scope?.tenantIds, scope?.sourceIds]) {
      if (list !== undefined && (!Array.isArray(list) || list.some((id) => typeof id !== "string")))
        throw new DetectorConfigurationError("Rule scope is invalid.");
    }
    return Object.freeze({
      ...rule,
      scope: scope ? Object.freeze({ ...scope }) : undefined,
    }) as DetectorRule;
  });
  return Object.freeze({
    schemaVersion: DETECTOR_RULESET_SCHEMA_VERSION,
    version: value.version,
    rules: Object.freeze(rules),
  });
}

export function parseRuleSet(serialized: string): Readonly<DetectorRuleSet> {
  try {
    return validateRuleSet(JSON.parse(serialized));
  } catch (error) {
    throw error instanceof DetectorConfigurationError
      ? error
      : new DetectorConfigurationError("Rule set is not valid JSON.");
  }
}
export function ruleSetDigest(ruleSet: DetectorRuleSet): string {
  return `sha256:${createHash("sha256")
    .update(canonical(validateRuleSet(ruleSet)))
    .digest("hex")}`;
}

export class DeterministicRuleEngine {
  readonly #ruleSet: Readonly<DetectorRuleSet>;
  readonly #telemetry: DetectionTelemetry | undefined;
  constructor(ruleSet: DetectorRuleSet, telemetry?: DetectionTelemetry) {
    this.#ruleSet = validateRuleSet(ruleSet);
    this.#telemetry = telemetry;
  }
  evaluate(
    input: Readonly<{ content: string; tenantId?: string; sourceId?: string }>,
  ): Readonly<DetectionVerdict> {
    const folded = input.content.toLocaleLowerCase("en-US");
    const findings: DetectionFinding[] = [];
    for (const rule of this.#ruleSet.rules) {
      if (!applies(rule, input.tenantId, input.sourceId)) continue;
      const phrase = rule.phrase.toLocaleLowerCase("en-US");
      let offset = folded.indexOf(phrase);
      while (offset >= 0) {
        findings.push(
          Object.freeze({
            ruleId: rule.id,
            reasonCode: rule.reasonCode,
            severity: rule.severity,
            disposition: rule.disposition,
            location: location(input.content, offset, rule.phrase.length),
          }),
        );
        offset = folded.indexOf(phrase, offset + phrase.length);
      }
    }
    const disposition = findings.reduce<DetectionDisposition>(
      (current, finding) =>
        dispositionRank[finding.disposition] > dispositionRank[current]
          ? finding.disposition
          : current,
      "allow",
    );
    const verdict = Object.freeze({
      disposition,
      findings: Object.freeze(findings),
      ruleSetDigest: ruleSetDigest(this.#ruleSet),
      ruleSetVersion: this.#ruleSet.version,
    });
    this.#telemetry?.record({
      outcome: disposition,
      findingCount: findings.length,
      ruleSetDigest: verdict.ruleSetDigest,
    });
    return verdict;
  }
}

export class ReloadableRuleEngine {
  #engine: DeterministicRuleEngine;
  constructor(initial: DetectorRuleSet) {
    this.#engine = new DeterministicRuleEngine(initial);
  }
  evaluate(input: Readonly<{ content: string; tenantId?: string; sourceId?: string }>) {
    return this.#engine.evaluate(input);
  }
  reload(
    serialized: string,
  ): Readonly<{ applied: boolean; ruleSetDigest?: string; error?: string }> {
    try {
      const rules = parseRuleSet(serialized);
      const next = new DeterministicRuleEngine(rules);
      this.#engine = next;
      return Object.freeze({
        applied: true,
        ruleSetDigest: ruleSetDigest(rules),
      });
    } catch (error) {
      return Object.freeze({
        applied: false,
        error: error instanceof Error ? error.message : "Rule reload failed.",
      });
    }
  }
}
