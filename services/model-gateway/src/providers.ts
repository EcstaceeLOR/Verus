import {
  ModelProviderError,
  type ModelProvider,
  type ModelProviderErrorCode,
  type ModelProviderIdentity,
  type ModelProviderTelemetry,
  type ModelRequest,
  type ModelResponse,
  type ModelUsage,
} from "./contracts.js";
import {
  PUBLIC_ONLY_PRIVACY_POLICY,
  enforceProviderPrivacy,
  type ProviderPrivacyPolicy,
} from "./privacy.js";

type Fetch = typeof globalThis.fetch;
type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export interface OpenAICompatibleProviderOptions {
  readonly provider: string;
  readonly apiKey?: string;
  readonly endpoint: string;
  readonly completionPath: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly timeoutMs: number;
  readonly maximumRetries: number;
  readonly retryBaseDelayMs: number;
  readonly maximumRetryDelayMs: number;
  readonly maximumInputCharacters: number;
  readonly maximumOutputTokens: number;
  readonly maximumResponseBytes: number;
  readonly privacy?: ProviderPrivacyPolicy;
  readonly telemetry?: ModelProviderTelemetry;
  readonly fetch?: Fetch;
  readonly sleep?: Sleep;
  readonly now?: () => number;
  readonly allowInsecureLocalhost?: boolean;
}

export interface QwenProviderOptions extends Omit<
  OpenAICompatibleProviderOptions,
  "provider" | "completionPath"
> {
  readonly apiKey: string;
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const dataClassifications = new Set(["public", "internal", "confidential", "restricted"]);

class ProviderAttemptError extends ModelProviderError {
  readonly retryAfterMs: number | undefined;

  constructor(
    code: ModelProviderErrorCode,
    message: string,
    options?: Readonly<{
      retryable?: boolean;
      retryAfterMs?: number;
      status?: number;
      cause?: unknown;
    }>,
  ) {
    super(code, message, options);
    this.retryAfterMs = options?.retryAfterMs;
  }
}

function assertInteger(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ModelProviderError(
      "MODEL_CONFIGURATION_INVALID",
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
}

function parseEndpoint(options: OpenAICompatibleProviderOptions): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint);
  } catch (cause) {
    throw new ModelProviderError("MODEL_CONFIGURATION_INVALID", "Invalid provider endpoint.", {
      cause,
    });
  }
  if (endpoint.username || endpoint.password) {
    throw new ModelProviderError(
      "MODEL_CONFIGURATION_INVALID",
      "Provider endpoint credentials must not be embedded in the URL.",
    );
  }
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (
    endpoint.protocol !== "https:" &&
    !(endpoint.protocol === "http:" && isLoopback && options.allowInsecureLocalhost === true)
  ) {
    throw new ModelProviderError(
      "MODEL_CONFIGURATION_INVALID",
      "Provider endpoints must use HTTPS; HTTP is limited to explicitly enabled loopback hosts.",
    );
  }
  return endpoint;
}

function validateOptions(options: OpenAICompatibleProviderOptions): URL {
  if (!/^[a-z][a-z0-9_-]{1,63}$/u.test(options.provider)) {
    throw new ModelProviderError("MODEL_CONFIGURATION_INVALID", "Invalid provider identifier.");
  }
  if (!options.model.trim() || !options.modelVersion.trim()) {
    throw new ModelProviderError(
      "MODEL_CONFIGURATION_INVALID",
      "Model and immutable model version are required.",
    );
  }
  if (!options.completionPath.startsWith("/") || options.completionPath.includes("..")) {
    throw new ModelProviderError("MODEL_CONFIGURATION_INVALID", "Invalid completion path.");
  }
  assertInteger(options.timeoutMs, 100, 120_000, "timeoutMs");
  assertInteger(options.maximumRetries, 0, 5, "maximumRetries");
  assertInteger(options.retryBaseDelayMs, 1, 30_000, "retryBaseDelayMs");
  assertInteger(options.maximumRetryDelayMs, 1, 120_000, "maximumRetryDelayMs");
  assertInteger(options.maximumInputCharacters, 1, 2_000_000, "maximumInputCharacters");
  assertInteger(options.maximumOutputTokens, 1, 32_768, "maximumOutputTokens");
  assertInteger(options.maximumResponseBytes, 1_024, 10_000_000, "maximumResponseBytes");
  return parseEndpoint(options);
}

function validateRequest(request: ModelRequest, options: OpenAICompatibleProviderOptions): void {
  if (!request.content || request.content.length > options.maximumInputCharacters) {
    throw new ModelProviderError(
      "MODEL_BUDGET_EXCEEDED",
      "Model input exceeds the configured character budget.",
    );
  }
  if (
    !Number.isSafeInteger(request.maximumTokens) ||
    request.maximumTokens < 1 ||
    request.maximumTokens > options.maximumOutputTokens
  ) {
    throw new ModelProviderError(
      "MODEL_BUDGET_EXCEEDED",
      "Model output exceeds the configured token budget.",
    );
  }
  if (!request.promptVersion.trim() || request.promptVersion.length > 128) {
    throw new ModelProviderError("MODEL_CONFIGURATION_INVALID", "Invalid prompt version.");
  }
  if (!request.responseSchema.id.trim() || request.responseSchema.id.length > 128) {
    throw new ModelProviderError("MODEL_CONFIGURATION_INVALID", "Invalid response schema ID.");
  }
  if (!dataClassifications.has(request.dataClassification)) {
    throw new ModelProviderError("MODEL_CONFIGURATION_INVALID", "Invalid data classification.");
  }
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ModelProviderError("MODEL_ABORTED", "Model request was cancelled."));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(new ModelProviderError("MODEL_ABORTED", "Model request was cancelled."));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function retryAfterMilliseconds(
  value: string | null,
  now: number,
  maximum: number,
): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  const parsed = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - now;
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.min(Math.ceil(parsed), maximum);
}

function responseUsage(value: unknown): Readonly<ModelUsage> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const usage = value as Record<string, unknown>;
  const numeric = (candidate: unknown) =>
    typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0
      ? candidate
      : undefined;
  const inputTokens = numeric(usage.prompt_tokens);
  const outputTokens = numeric(usage.completion_tokens);
  const totalTokens = numeric(usage.total_tokens);
  const result: ModelUsage = {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
  return Object.values(result).some((item) => item !== undefined)
    ? Object.freeze(result)
    : undefined;
}

function asModelError(error: unknown, timedOut: boolean, aborted: boolean): ProviderAttemptError {
  if (error instanceof ProviderAttemptError) return error;
  if (error instanceof ModelProviderError) {
    return new ProviderAttemptError(error.code, error.message, {
      retryable: error.retryable,
      ...(error.status === undefined ? {} : { status: error.status }),
      cause: error,
    });
  }
  if (timedOut) {
    return new ProviderAttemptError("MODEL_TIMEOUT", "Model provider request timed out.", {
      retryable: true,
      cause: error,
    });
  }
  if (aborted) {
    return new ProviderAttemptError("MODEL_ABORTED", "Model request was cancelled.", {
      cause: error,
    });
  }
  return new ProviderAttemptError("MODEL_UNAVAILABLE", "Model provider is unavailable.", {
    retryable: true,
    cause: error,
  });
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly identity: Readonly<ModelProviderIdentity>;
  readonly #options: OpenAICompatibleProviderOptions;
  readonly #endpoint: URL;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.#endpoint = validateOptions(options);
    this.#options = Object.freeze({ ...options });
    this.identity = Object.freeze({
      provider: options.provider,
      model: options.model,
      modelVersion: options.modelVersion,
    });
  }

  async complete(request: ModelRequest): Promise<Readonly<ModelResponse>> {
    try {
      validateRequest(request, this.#options);
      enforceProviderPrivacy(request, this.#options.privacy ?? PUBLIC_ONLY_PRIVACY_POLICY);
    } catch (error) {
      const failure = asModelError(error, false, false);
      this.#record(
        request,
        failure.code === "MODEL_PRIVACY_DENIED" ? "privacy_denied" : "failure",
        0,
        0,
        failure,
      );
      throw failure;
    }
    if (request.signal?.aborted) {
      const failure = new ProviderAttemptError("MODEL_ABORTED", "Model request was cancelled.");
      this.#record(request, "failure", 0, 0, failure);
      throw failure;
    }

    for (let attempt = 1; attempt <= this.#options.maximumRetries + 1; attempt += 1) {
      const startedAt = this.#now();
      try {
        const response = await this.#attempt(request);
        this.#record(request, "success", attempt, this.#now() - startedAt);
        return response;
      } catch (error) {
        const failure = asModelError(error, false, request.signal?.aborted === true);
        const canRetry = failure.retryable && attempt <= this.#options.maximumRetries;
        this.#record(
          request,
          canRetry ? "retry" : "failure",
          attempt,
          this.#now() - startedAt,
          failure,
        );
        if (!canRetry) throw failure;
        const exponential = Math.min(
          this.#options.retryBaseDelayMs * 2 ** (attempt - 1),
          this.#options.maximumRetryDelayMs,
        );
        const delay = Math.max(exponential, failure.retryAfterMs ?? 0);
        await (this.#options.sleep ?? defaultSleep)(delay, request.signal);
      }
    }
    throw new ModelProviderError("MODEL_UNAVAILABLE", "Model provider is unavailable.");
  }

  async #attempt(request: ModelRequest): Promise<Readonly<ModelResponse>> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#options.timeoutMs);
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (this.#options.apiKey) headers.authorization = `Bearer ${this.#options.apiKey}`;
      const response = await (this.#options.fetch ?? globalThis.fetch)(
        new URL(this.#options.completionPath, this.#endpoint),
        {
          method: "POST",
          signal: controller.signal,
          headers,
          body: JSON.stringify({
            model: this.#options.model,
            messages: [
              {
                role: "system",
                content: `Return JSON only for Verus ${request.task}; prompt=${request.promptVersion}; schema=${request.responseSchema.id}.`,
              },
              { role: "user", content: request.content },
            ],
            response_format: { type: "json_object" },
            max_tokens: request.maximumTokens,
            temperature: 0,
          }),
        },
      );
      if (!response.ok) {
        const retryable = RETRYABLE_STATUSES.has(response.status);
        const retryAfterMs = retryable
          ? retryAfterMilliseconds(
              response.headers.get("retry-after"),
              this.#now(),
              this.#options.maximumRetryDelayMs,
            )
          : undefined;
        throw new ProviderAttemptError("MODEL_HTTP_ERROR", "Model provider rejected the request.", {
          status: response.status,
          retryable,
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        });
      }
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > this.#options.maximumResponseBytes) {
        throw new ProviderAttemptError(
          "MODEL_RESPONSE_TOO_LARGE",
          "Model provider response exceeds the byte budget.",
        );
      }
      const serialized = await response.text();
      if (Buffer.byteLength(serialized, "utf8") > this.#options.maximumResponseBytes) {
        throw new ProviderAttemptError(
          "MODEL_RESPONSE_TOO_LARGE",
          "Model provider response exceeds the byte budget.",
        );
      }
      return this.#parseResponse(serialized, request);
    } catch (error) {
      throw asModelError(error, timedOut, request.signal?.aborted === true);
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abort);
    }
  }

  #parseResponse(serialized: string, request: ModelRequest): Readonly<ModelResponse> {
    try {
      const payload = JSON.parse(serialized) as unknown;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
      const record = payload as Record<string, unknown>;
      const choices = record.choices;
      if (!Array.isArray(choices) || choices.length !== 1) throw new Error();
      const choice = choices[0];
      if (!choice || typeof choice !== "object" || Array.isArray(choice)) throw new Error();
      const message = (choice as Record<string, unknown>).message;
      if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error();
      const content = (message as Record<string, unknown>).content;
      if (typeof content !== "string" || !content) throw new Error();
      const output = request.responseSchema.parse(JSON.parse(content) as unknown);
      const providerRequestId = typeof record.id === "string" ? record.id : undefined;
      const usage = responseUsage(record.usage);
      return Object.freeze({
        output,
        ...this.identity,
        promptVersion: request.promptVersion,
        responseSchema: request.responseSchema.id,
        ...(providerRequestId === undefined ? {} : { providerRequestId }),
        ...(usage === undefined ? {} : { usage }),
      });
    } catch (cause) {
      throw new ProviderAttemptError(
        "MODEL_RESPONSE_INVALID",
        "Model provider returned an invalid structured response.",
        { retryable: true, cause },
      );
    }
  }

  #now(): number {
    return (this.#options.now ?? Date.now)();
  }

  #record(
    request: ModelRequest,
    outcome: "success" | "retry" | "failure" | "privacy_denied",
    attempt: number,
    durationMs: number,
    error?: ProviderAttemptError,
  ): void {
    this.#options.telemetry?.record({
      outcome,
      ...this.identity,
      promptVersion: request.promptVersion,
      responseSchema: request.responseSchema.id,
      attempt,
      durationMs: Math.max(0, durationMs),
      ...(error === undefined ? {} : { errorCode: error.code }),
      ...(error?.status === undefined ? {} : { status: error.status }),
    });
  }
}

export class QwenProvider extends OpenAICompatibleProvider {
  constructor(options: QwenProviderOptions) {
    if (!options.apiKey.trim()) {
      throw new ModelProviderError("MODEL_CONFIGURATION_INVALID", "Qwen API key is required.");
    }
    super({ ...options, provider: "qwen", completionPath: "/compatible-mode/v1/chat/completions" });
  }
}

export class DeterministicFakeProvider implements ModelProvider {
  readonly identity: Readonly<ModelProviderIdentity>;

  constructor(
    readonly output: unknown,
    identity: ModelProviderIdentity = {
      provider: "fake",
      model: "deterministic",
      modelVersion: "1",
    },
  ) {
    this.identity = Object.freeze({ ...identity });
  }

  async complete(request: ModelRequest): Promise<Readonly<ModelResponse>> {
    if (request.signal?.aborted) {
      throw new ModelProviderError("MODEL_ABORTED", "Model request was cancelled.");
    }
    return Object.freeze({
      output: request.responseSchema.parse(structuredClone(this.output)),
      ...this.identity,
      promptVersion: request.promptVersion,
      responseSchema: request.responseSchema.id,
    });
  }
}
