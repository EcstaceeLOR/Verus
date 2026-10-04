import type {
  ModelDataClassification,
  ModelProvider,
  ModelProviderIdentity,
  ModelResponseSchema,
} from "./contracts.js";

export type ClassifierDisposition = "review" | "block";
export type DeterministicDisposition = "allow" | ClassifierDisposition;

export interface ClassifierProvider {
  readonly identity: Readonly<{
    provider: string;
    model: string;
    modelVersion: string;
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
      disposition: ClassifierDisposition;
      provider: string;
      model: string;
      modelVersion: string;
      promptVersion: string;
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
  readonly modelVersion: string;
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

export function parseClassifierOutput(value: unknown): Readonly<{
  disposition: ClassifierDisposition;
  confidence: number;
  categories: readonly string[];
}> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError();
  const output = value as Record<string, unknown>;
  const keys = Object.keys(output);
  if (
    keys.some((key) => !["disposition", "confidence", "categories"].includes(key)) ||
    (output.disposition !== "review" && output.disposition !== "block") ||
    typeof output.confidence !== "number" ||
    !Number.isFinite(output.confidence) ||
    output.confidence < 0 ||
    output.confidence > 1 ||
    !Array.isArray(output.categories) ||
    output.categories.length > allowedCategories.size ||
    output.categories.some((entry) => typeof entry !== "string" || !allowedCategories.has(entry)) ||
    new Set(output.categories).size !== output.categories.length
  ) {
    throw new TypeError("Invalid classifier output.");
  }
  return Object.freeze({
    disposition: output.disposition,
    confidence: output.confidence,
    categories: Object.freeze([...output.categories] as string[]),
  });
}

export const CLASSIFIER_RESPONSE_SCHEMA: ModelResponseSchema = Object.freeze({
  id: "verus.classifier.v1",
  parse: parseClassifierOutput,
});

export interface ModelBackedClassifierOptions {
  readonly promptVersion: string;
  readonly classifierVersion: string;
  readonly maximumTokens: number;
  readonly dataClassification: ModelDataClassification;
  readonly sensitiveContentConsent?: boolean;
}

export class ModelBackedClassifierProvider implements ClassifierProvider {
  readonly identity: Readonly<
    ModelProviderIdentity & { promptVersion: string; classifierVersion: string }
  >;
  readonly #provider: ModelProvider;
  readonly #options: ModelBackedClassifierOptions;

  constructor(provider: ModelProvider, options: ModelBackedClassifierOptions) {
    this.#provider = provider;
    this.#options = Object.freeze({ ...options });
    this.identity = Object.freeze({
      ...provider.identity,
      promptVersion: options.promptVersion,
      classifierVersion: options.classifierVersion,
    });
  }

  async classify(
    input: Readonly<{ content: string; responseSchema: "verus.classifier.v1" }>,
  ): Promise<unknown> {
    if (input.responseSchema !== CLASSIFIER_RESPONSE_SCHEMA.id) throw new TypeError();
    const response = await this.#provider.complete({
      task: "classification",
      content: input.content,
      promptVersion: this.#options.promptVersion,
      maximumTokens: this.#options.maximumTokens,
      responseSchema: CLASSIFIER_RESPONSE_SCHEMA,
      dataClassification: this.#options.dataClassification,
      ...(this.#options.sensitiveContentConsent === undefined
        ? {}
        : { sensitiveContentConsent: this.#options.sensitiveContentConsent }),
    });
    return response.output;
  }
}

export class IsolatedClassifier {
  readonly #provider: ClassifierProvider;
  readonly #telemetry: ClassifierTelemetry | undefined;

  constructor(provider: ClassifierProvider, telemetry?: ClassifierTelemetry) {
    this.#provider = provider;
    this.#telemetry = telemetry;
  }

  async classify(
    content: string,
    deterministicDisposition: DeterministicDisposition = "allow",
  ): Promise<Readonly<ClassifierSignal>> {
    let signal: ClassifierSignal;
    let outcome: "success" | "safe_fallback";
    try {
      const parsed = parseClassifierOutput(
        await this.#provider.classify({ content, responseSchema: "verus.classifier.v1" }),
      );
      signal = Object.freeze({ ...parsed, ...this.#provider.identity, safeFallback: false });
      outcome = "success";
    } catch {
      signal = fallback(this.#provider);
      outcome = "safe_fallback";
    }
    if (deterministicDisposition === "block" && signal.disposition !== "block") {
      signal = Object.freeze({ ...signal, disposition: "block" });
    }
    this.#telemetry?.record({
      outcome,
      disposition: signal.disposition,
      provider: signal.provider,
      model: signal.model,
      modelVersion: signal.modelVersion,
      promptVersion: signal.promptVersion,
      classifierVersion: signal.classifierVersion,
    });
    return signal;
  }
}
