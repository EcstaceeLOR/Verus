import {
  ContractValidationError,
  UnsupportedContractVersionError,
  type ContractIssue,
} from "@verus/contracts";

import { ERROR_DEFINITIONS, type VerusErrorCode } from "./error-codes.js";

export interface PublicContractIssue {
  readonly path: string;
  readonly keyword: string;
  readonly message: string;
}

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: VerusErrorCode;
  readonly retryable: boolean;
  readonly correlation_id?: string;
  readonly errors?: readonly PublicContractIssue[];
}

export class VerusError extends Error {
  readonly code: VerusErrorCode;

  constructor(code: VerusErrorCode, internalMessage: string, options?: ErrorOptions) {
    super(internalMessage, options);
    this.name = "VerusError";
    this.code = code;
  }
}

function safeCorrelationId(value: string | undefined): string | undefined {
  return value !== undefined && /^[A-Za-z0-9_-]{8,128}$/.test(value) ? value : undefined;
}

function publicIssues(issues: readonly ContractIssue[]): readonly PublicContractIssue[] {
  return Object.freeze(
    issues.slice(0, 20).map(({ path, keyword }) => {
      const safePath = path.length <= 512 && /^\/(?:[A-Za-z0-9_~-]+\/?)*$/.test(path) ? path : "/";
      const safeKeyword =
        keyword.length <= 64 && /^[A-Za-z][A-Za-z0-9_-]*$/.test(keyword) ? keyword : "validation";
      return Object.freeze({
        path: safePath,
        keyword: safeKeyword,
        message: `does not satisfy ${safeKeyword}`,
      });
    }),
  );
}

function resolveError(error: unknown): {
  code: VerusErrorCode;
  errors?: readonly PublicContractIssue[];
} {
  if (error instanceof ContractValidationError) {
    return { code: "CONTRACT_VALIDATION_FAILED", errors: publicIssues(error.issues) };
  }
  if (error instanceof UnsupportedContractVersionError) {
    return { code: "UNSUPPORTED_CONTRACT_VERSION" };
  }
  if (error instanceof VerusError) return { code: error.code };
  return { code: "INTERNAL_ERROR" };
}

export function toProblemDetails(error: unknown, correlationId?: string): Readonly<ProblemDetails> {
  const resolved = resolveError(error);
  const definition = ERROR_DEFINITIONS[resolved.code];
  const safeId = safeCorrelationId(correlationId);
  return Object.freeze({
    type: `https://verus.security/problems/${resolved.code.toLowerCase().replaceAll("_", "-")}`,
    title: definition.title,
    status: definition.status,
    code: resolved.code,
    retryable: definition.retryable,
    ...(safeId === undefined ? {} : { correlation_id: safeId }),
    ...(resolved.errors === undefined ? {} : { errors: resolved.errors }),
  });
}
