export const VERUS_ERROR_CODES = Object.freeze({
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  AUTHORIZATION_DENIED: "AUTHORIZATION_DENIED",
  CONFLICT: "CONFLICT",
  CONTRACT_VALIDATION_FAILED: "CONTRACT_VALIDATION_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  UNSUPPORTED_CONTRACT_VERSION: "UNSUPPORTED_CONTRACT_VERSION",
} as const);

export type VerusErrorCode = (typeof VERUS_ERROR_CODES)[keyof typeof VERUS_ERROR_CODES];

export interface ErrorDefinition {
  readonly status: number;
  readonly title: string;
  readonly retryable: boolean;
}

export const ERROR_DEFINITIONS: Readonly<Record<VerusErrorCode, ErrorDefinition>> = Object.freeze({
  AUTHENTICATION_REQUIRED: { status: 401, title: "Authentication required", retryable: false },
  AUTHORIZATION_DENIED: { status: 403, title: "Access denied", retryable: false },
  CONFLICT: { status: 409, title: "Conflict", retryable: false },
  CONTRACT_VALIDATION_FAILED: {
    status: 400,
    title: "Contract validation failed",
    retryable: false,
  },
  INTERNAL_ERROR: { status: 500, title: "Internal error", retryable: false },
  NOT_FOUND: { status: 404, title: "Resource not found", retryable: false },
  RATE_LIMITED: { status: 429, title: "Rate limit exceeded", retryable: true },
  SERVICE_UNAVAILABLE: { status: 503, title: "Service unavailable", retryable: true },
  UNSUPPORTED_CONTRACT_VERSION: {
    status: 406,
    title: "Contract version is not supported",
    retryable: false,
  },
});
