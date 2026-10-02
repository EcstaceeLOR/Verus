export type ClassifierDisposition = "review" | "block";
export interface ClassifierProvider {
  readonly identity: Readonly<{
    provider: string;
    model: string;
    promptVersion: string;
    classifierVersion: string;
  }>;
  classify(
    input: Readonly<{ content: string; responseSchema: "verus.classifier.v1" }>,
  ): Promise<unknown>;
}
export interface ClassifierTelemetry {
  record(
    event: Readonly<{
      outcome: "success" | "safe_fallback";
      provider: string;
      model: string;
      classifierVersion: string;
    }>,
  ): void;
}
export interface ClassifierSignal {
  readonly disposition: ClassifierDisposition;
  readonly confidence: number;
  readonly categories: readonly string[];
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly classifierVersion: string;
  readonly safeFallback: boolean;
}
const allowedCategories = new Set([
  "instruction_override",
  "tool_coercion",
  "encoded_evasion",
  "source_impersonation",
  "hidden_content",
]);
function fallback(provider: ClassifierProvider): ClassifierSignal {
  return Object.freeze({
    disposition: "review",
    confidence: 0,
    categories: Object.freeze([]),
    ...provider.identity,
    safeFallback: true,
  });
}
function validate(value: unknown, provider: ClassifierProvider): ClassifierSignal | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const output = value as Record<string, unknown>;
  if (
    (output.disposition !== "review" && output.disposition !== "block") ||
    typeof output.confidence !== "number" ||
    !Number.isFinite(output.confidence) ||
    output.confidence < 0 ||
    output.confidence > 1 ||
    !Array.isArray(output.categories) ||
    output.categories.some((entry) => typeof entry !== "string" || !allowedCategories.has(entry))
  )
    return undefined;
  return Object.freeze({
    disposition: output.disposition,
    confidence: output.confidence,
    categories: Object.freeze([...output.categories] as string[]),
    ...provider.identity,
    safeFallback: false,
  });
}
export class IsolatedClassifier {
  readonly #provider: ClassifierProvider;
  readonly #telemetry: ClassifierTelemetry | undefined;
  constructor(provider: ClassifierProvider, telemetry?: ClassifierTelemetry) {
    this.#provider = provider;
    this.#telemetry = telemetry;
  }
  async classify(content: string): Promise<Readonly<ClassifierSignal>> {
    try {
      const signal = validate(
        await this.#provider.classify({ content, responseSchema: "verus.classifier.v1" }),
        this.#provider,
      );
      if (!signal) throw new Error("invalid model output");
      this.#telemetry?.record({
        outcome: "success",
        provider: signal.provider,
        model: signal.model,
        classifierVersion: signal.classifierVersion,
      });
      return signal;
    } catch {
      const signal = fallback(this.#provider);
      this.#telemetry?.record({
        outcome: "safe_fallback",
        provider: signal.provider,
        model: signal.model,
        classifierVersion: signal.classifierVersion,
      });
      return signal;
    }
  }
}
