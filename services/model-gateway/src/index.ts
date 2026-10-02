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
export interface ModelRequest {
  readonly task: "classification" | "extraction" | "explanation";
  readonly promptVersion: string;
  readonly content: string;
  readonly maximumTokens: number;
}
export interface ModelResponse {
  readonly output: unknown;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly requestId?: string;
}
export interface ModelProvider {
  readonly identity: Readonly<{ provider: string; model: string }>;
  complete(request: ModelRequest): Promise<Readonly<ModelResponse>>;
}
export class DeterministicFakeProvider implements ModelProvider {
  readonly identity = Object.freeze({ provider: "fake", model: "deterministic" });
  constructor(readonly output: unknown) {}
  async complete(request: ModelRequest): Promise<Readonly<ModelResponse>> {
    return Object.freeze({
      output: this.output,
      ...this.identity,
      promptVersion: request.promptVersion,
    });
  }
}
export class QwenProvider implements ModelProvider {
  readonly identity: Readonly<{ provider: string; model: string }>;
  constructor(
    readonly options: Readonly<{
      apiKey: string;
      baseUrl: string;
      model: string;
      timeoutMs: number;
      maximumRetries: number;
      fetch?: typeof globalThis.fetch;
      allowSensitiveContent: boolean;
    }>,
  ) {
    this.identity = Object.freeze({ provider: "qwen", model: options.model });
  }
  async complete(request: ModelRequest): Promise<Readonly<ModelResponse>> {
    if (
      !this.options.allowSensitiveContent &&
      /(?:api[_ -]?key|password|secret)\s*[:=]/iu.test(request.content)
    )
      throw new Error("MODEL_SENSITIVE_CONTENT_DENIED");
    if (request.maximumTokens < 1 || request.maximumTokens > 4096)
      throw new Error("MODEL_TOKEN_BUDGET_INVALID");
    const fetcher = this.options.fetch ?? globalThis.fetch;
    let failure: unknown;
    for (let attempt = 0; attempt <= this.options.maximumRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const response = await fetcher(
          new URL("/compatible-mode/v1/chat/completions", this.options.baseUrl),
          {
            method: "POST",
            signal: controller.signal,
            headers: {
              authorization: `Bearer ${this.options.apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: this.options.model,
              messages: [
                {
                  role: "system",
                  content: `Return JSON only for Verus ${request.task}; prompt=${request.promptVersion}.`,
                },
                { role: "user", content: request.content },
              ],
              response_format: { type: "json_object" },
              max_tokens: request.maximumTokens,
              temperature: 0,
            }),
          },
        );
        if (!response.ok) throw new Error(`QWEN_HTTP_${response.status}`);
        const payload = (await response.json()) as {
          choices?: readonly { message?: { content?: string } }[];
          id?: string;
        };
        const content = payload.choices?.[0]?.message?.content;
        if (!content) throw new Error("QWEN_RESPONSE_INVALID");
        return Object.freeze({
          output: JSON.parse(content) as unknown,
          ...this.identity,
          promptVersion: request.promptVersion,
          ...(payload.id ? { requestId: payload.id } : {}),
        });
      } catch (error) {
        failure = error;
        if (attempt === this.options.maximumRetries) throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw failure;
  }
}
