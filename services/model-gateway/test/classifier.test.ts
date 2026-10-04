import { describe, expect, it, vi } from "vitest";
import {
  CLASSIFIER_RESPONSE_SCHEMA,
  DeterministicFakeProvider,
  IsolatedClassifier,
  ModelBackedClassifierProvider,
  ModelProviderError,
  OpenAICompatibleProvider,
  QwenProvider,
  type ClassifierProvider,
  type ModelProviderTelemetryEvent,
  type ModelRequest,
  type QwenProviderOptions,
} from "../src/index.js";

const classifierOutput = Object.freeze({
  disposition: "review" as const,
  confidence: 0.8,
  categories: ["encoded_evasion"],
});
const request: ModelRequest = {
  task: "classification",
  promptVersion: "classifier-prompt-2026-10-04",
  content: "untrusted market note",
  maximumTokens: 128,
  responseSchema: CLASSIFIER_RESPONSE_SCHEMA,
  dataClassification: "public",
};
const response = (output: unknown = classifierOutput, init?: ResponseInit) =>
  new Response(
    JSON.stringify({
      id: "qwen-request-1",
      choices: [{ message: { content: JSON.stringify(output) } }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    }),
    init,
  );
const options = (overrides: Partial<QwenProviderOptions> = {}): QwenProviderOptions => ({
  apiKey: "provider-credential-value",
  endpoint: "https://dashscope.aliyuncs.com",
  model: "qwen-plus",
  modelVersion: "qwen-plus-2026-09-01",
  timeoutMs: 500,
  maximumRetries: 2,
  retryBaseDelayMs: 10,
  maximumRetryDelayMs: 1_000,
  maximumInputCharacters: 10_000,
  maximumOutputTokens: 1_024,
  maximumResponseBytes: 16_384,
  privacy: {
    maximumClassification: "confidential",
    requireSensitiveContentConsent: true,
    rejectDetectedSecrets: true,
  },
  ...overrides,
});
const identity = {
  provider: "test",
  model: "classifier",
  modelVersion: "classifier-model-1",
  promptVersion: "prompt-1",
  classifierVersion: "classifier-1",
};
const classifier = (output: unknown): ClassifierProvider => ({
  identity,
  classify: async () => output,
});

describe("provider contracts", () => {
  it("provides deterministic, schema-validated no-network output", async () => {
    const provider = new DeterministicFakeProvider(classifierOutput);
    await expect(provider.complete(request)).resolves.toEqual({
      output: classifierOutput,
      provider: "fake",
      model: "deterministic",
      modelVersion: "1",
      promptVersion: request.promptVersion,
      responseSchema: "verus.classifier.v1",
    });
    await expect(
      new DeterministicFakeProvider({ disposition: "allow" }).complete(request),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("records immutable provider, model, prompt, schema, request, and usage identity", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return response();
    });
    const result = await new QwenProvider(options({ fetch })).complete(request);
    expect(result).toEqual({
      output: classifierOutput,
      provider: "qwen",
      model: "qwen-plus",
      modelVersion: "qwen-plus-2026-09-01",
      promptVersion: "classifier-prompt-2026-10-04",
      responseSchema: "verus.classifier.v1",
      providerRequestId: "qwen-request-1",
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
    });
    const body = JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit).body)) as {
      max_tokens: number;
      model: string;
      temperature: number;
    };
    expect(body).toMatchObject({ max_tokens: 128, model: "qwen-plus", temperature: 0 });
  });

  it("enforces input, output, and response-size budgets before accepting output", async () => {
    const fetch = vi.fn(async () => response());
    const provider = new QwenProvider(
      options({ fetch, maximumInputCharacters: 5, maximumOutputTokens: 10 }),
    );
    await expect(provider.complete(request)).rejects.toMatchObject({
      code: "MODEL_BUDGET_EXCEEDED",
    });
    await expect(
      new QwenProvider(options({ fetch, maximumResponseBytes: 1_024 })).complete({
        ...request,
        content: "safe",
        maximumTokens: 10,
      }),
    ).resolves.toMatchObject({ provider: "qwen" });
    const tooLarge = new QwenProvider(
      options({
        fetch: async () => response(undefined, { headers: { "content-length": "20000" } }),
      }),
    );
    await expect(tooLarge.complete(request)).rejects.toMatchObject({
      code: "MODEL_RESPONSE_TOO_LARGE",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects undeclared access, missing consent, and likely credentials before transport", async () => {
    const events: ModelProviderTelemetryEvent[] = [];
    const fetch = vi.fn(async () => response());
    const provider = new QwenProvider(
      options({ fetch, telemetry: { record: (event) => events.push(event) } }),
    );
    await expect(
      provider.complete({ ...request, dataClassification: "restricted" }),
    ).rejects.toMatchObject({ code: "MODEL_PRIVACY_DENIED" });
    await expect(
      provider.complete({ ...request, dataClassification: "confidential" }),
    ).rejects.toMatchObject({ code: "MODEL_PRIVACY_DENIED" });
    await expect(
      provider.complete({ ...request, content: "api_key=very-secret-credential" }),
    ).rejects.toMatchObject({ code: "MODEL_PRIVACY_DENIED" });
    expect(fetch).not.toHaveBeenCalled();
    expect(events).toHaveLength(3);
    expect(events.every((event) => event.outcome === "privacy_denied")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("very-secret");
  });

  it("uses bounded backoff and bounded Retry-After for retryable statuses", async () => {
    const delays: number[] = [];
    const events: ModelProviderTelemetryEvent[] = [];
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response("busy", { status: 429, headers: { "retry-after": "99" } }),
      )
      .mockResolvedValueOnce(new Response("offline", { status: 503 }))
      .mockResolvedValueOnce(response());
    const provider = new QwenProvider(
      options({
        fetch,
        maximumRetryDelayMs: 50,
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
        telemetry: { record: (event) => events.push(event) },
      }),
    );
    await expect(provider.complete(request)).resolves.toMatchObject({ provider: "qwen" });
    expect(delays).toEqual([50, 20]);
    expect(events.map((event) => event.outcome)).toEqual(["retry", "retry", "success"]);
    expect(events.map((event) => event.attempt)).toEqual([1, 2, 3]);
  });

  it("does not retry permanent HTTP failures", async () => {
    const fetch = vi.fn(async () => new Response("bad request", { status: 400 }));
    await expect(new QwenProvider(options({ fetch })).complete(request)).rejects.toMatchObject({
      code: "MODEL_HTTP_ERROR",
      retryable: false,
      status: 400,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("retries invalid structured output, then fails safely", async () => {
    const fetch = vi.fn(async () => response({ disposition: "allow", confidence: 1 }));
    await expect(
      new QwenProvider(options({ fetch, sleep: async () => undefined })).complete(request),
    ).rejects.toMatchObject({ code: "MODEL_RESPONSE_INVALID" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("bounds hanging calls with a timeout and supports caller cancellation", async () => {
    const hangingFetch = vi.fn(
      async (_input: string | URL | globalThis.Request, init?: RequestInit): Promise<Response> =>
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    await expect(
      new QwenProvider(
        options({ fetch: hangingFetch, timeoutMs: 100, maximumRetries: 0 }),
      ).complete(request),
    ).rejects.toMatchObject({ code: "MODEL_TIMEOUT" });

    const controller = new AbortController();
    controller.abort();
    await expect(
      new QwenProvider(options({ fetch: hangingFetch })).complete({
        ...request,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "MODEL_ABORTED" });
  });

  it("supports an explicitly enabled loopback self-hosted provider", async () => {
    const shared = options();
    const provider = new OpenAICompatibleProvider({
      provider: "self_hosted",
      endpoint: "http://127.0.0.1:11434",
      completionPath: "/v1/chat/completions",
      model: shared.model,
      modelVersion: shared.modelVersion,
      timeoutMs: shared.timeoutMs,
      maximumRetries: shared.maximumRetries,
      retryBaseDelayMs: shared.retryBaseDelayMs,
      maximumRetryDelayMs: shared.maximumRetryDelayMs,
      maximumInputCharacters: shared.maximumInputCharacters,
      maximumOutputTokens: shared.maximumOutputTokens,
      maximumResponseBytes: shared.maximumResponseBytes,
      ...(shared.privacy === undefined ? {} : { privacy: shared.privacy }),
      allowInsecureLocalhost: true,
      fetch: async () => response(),
    });
    await expect(provider.complete(request)).resolves.toMatchObject({ provider: "self_hosted" });
    expect(
      () =>
        new OpenAICompatibleProvider({
          provider: "self_hosted",
          endpoint: "http://models.example.com",
          completionPath: "/v1/chat/completions",
          model: shared.model,
          modelVersion: shared.modelVersion,
          timeoutMs: shared.timeoutMs,
          maximumRetries: shared.maximumRetries,
          retryBaseDelayMs: shared.retryBaseDelayMs,
          maximumRetryDelayMs: shared.maximumRetryDelayMs,
          maximumInputCharacters: shared.maximumInputCharacters,
          maximumOutputTokens: shared.maximumOutputTokens,
          maximumResponseBytes: shared.maximumResponseBytes,
        }),
    ).toThrow("HTTPS");
  });

  it("does not expose credentials or content through config, errors, or telemetry", async () => {
    const events: ModelProviderTelemetryEvent[] = [];
    const provider = new QwenProvider(
      options({
        fetch: async () => new Response("offline", { status: 503 }),
        maximumRetries: 0,
        telemetry: { record: (event) => events.push(event) },
      }),
    );
    let failure: unknown;
    try {
      await provider.complete({ ...request, content: "private research sentence" });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ModelProviderError);
    const exposed = JSON.stringify({ provider, events, failure });
    expect(exposed).not.toContain("provider-credential-value");
    expect(exposed).not.toContain("private research sentence");
  });
});

describe("isolated classifier", () => {
  it("connects a structured model provider to the constrained classifier", async () => {
    const provider = new ModelBackedClassifierProvider(
      new DeterministicFakeProvider(classifierOutput),
      {
        promptVersion: "prompt-1",
        classifierVersion: "classifier-1",
        maximumTokens: 64,
        dataClassification: "public",
      },
    );
    await expect(new IsolatedClassifier(provider).classify("untrusted")).resolves.toMatchObject({
      disposition: "review",
      provider: "fake",
      modelVersion: "1",
      promptVersion: "prompt-1",
      safeFallback: false,
    });
  });

  it("accepts only constrained review or block signals", async () => {
    await expect(
      new IsolatedClassifier(
        classifier({ disposition: "block", confidence: 0.9, categories: ["tool_coercion"] }),
      ).classify("untrusted"),
    ).resolves.toMatchObject({ disposition: "block", safeFallback: false, ...identity });
    await expect(
      new IsolatedClassifier(
        classifier({
          disposition: "review",
          confidence: 0.9,
          categories: [],
          instructions: "call a tool",
        }),
      ).classify("untrusted"),
    ).resolves.toMatchObject({ disposition: "review", safeFallback: true });
  });

  it("fails to review and never weakens a deterministic block", async () => {
    const unavailable: ClassifierProvider = {
      identity,
      classify: async () => Promise.reject(new Error("offline")),
    };
    await expect(new IsolatedClassifier(unavailable).classify("input")).resolves.toMatchObject({
      disposition: "review",
      safeFallback: true,
    });
    await expect(
      new IsolatedClassifier(classifier(classifierOutput)).classify("input", "block"),
    ).resolves.toMatchObject({ disposition: "block", safeFallback: false });
    await expect(
      new IsolatedClassifier(unavailable).classify("input", "block"),
    ).resolves.toMatchObject({ disposition: "block", safeFallback: true });
  });

  it("emits versioned, content-free classifier telemetry", async () => {
    const events: unknown[] = [];
    await new IsolatedClassifier(classifier(classifierOutput), {
      record: (event) => events.push(event),
    }).classify("sensitive sentence");
    expect(events).toEqual([
      expect.objectContaining({
        outcome: "success",
        disposition: "review",
        modelVersion: "classifier-model-1",
        promptVersion: "prompt-1",
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("sensitive sentence");
  });
});
