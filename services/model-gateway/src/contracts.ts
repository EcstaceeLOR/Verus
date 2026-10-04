export type ModelTask = "classification" | "extraction" | "explanation";
export type ModelDataClassification = "public" | "internal" | "confidential" | "restricted";

export interface ModelResponseSchema {
  readonly id: string;
  parse(value: unknown): unknown;
}

export interface ModelRequest {
  readonly task: ModelTask;
  readonly promptVersion: string;
  readonly content: string;
  readonly maximumTokens: number;
  readonly responseSchema: ModelResponseSchema;
  readonly dataClassification: ModelDataClassification;
  readonly sensitiveContentConsent?: boolean;
  readonly signal?: AbortSignal;
}

export interface ModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface ModelResponse {
  readonly output: unknown;
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly responseSchema: string;
  readonly providerRequestId?: string;
  readonly usage?: Readonly<ModelUsage>;
}

export interface ModelProviderIdentity {
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string;
}

export interface ModelProvider {
  readonly identity: Readonly<ModelProviderIdentity>;
  complete(request: ModelRequest): Promise<Readonly<ModelResponse>>;
}

export type ModelProviderErrorCode =
  | "MODEL_ABORTED"
  | "MODEL_BUDGET_EXCEEDED"
  | "MODEL_CONFIGURATION_INVALID"
  | "MODEL_HTTP_ERROR"
  | "MODEL_PRIVACY_DENIED"
  | "MODEL_RESPONSE_INVALID"
  | "MODEL_RESPONSE_TOO_LARGE"
  | "MODEL_TIMEOUT"
  | "MODEL_UNAVAILABLE";

export class ModelProviderError extends Error {
  readonly code: ModelProviderErrorCode;
  readonly retryable: boolean;
  readonly status: number | undefined;

  constructor(
    code: ModelProviderErrorCode,
    message: string,
    options?: Readonly<{ retryable?: boolean; status?: number; cause?: unknown }>,
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ModelProviderError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.status = options?.status;
  }
}

export interface ModelProviderTelemetryEvent {
  readonly outcome: "success" | "retry" | "failure" | "privacy_denied";
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly responseSchema: string;
  readonly attempt: number;
  readonly durationMs: number;
  readonly errorCode?: ModelProviderErrorCode;
  readonly status?: number;
}

export interface ModelProviderTelemetry {
  record(event: Readonly<ModelProviderTelemetryEvent>): void;
}
