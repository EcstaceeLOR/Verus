import {
  ModelProviderError,
  type ModelDataClassification,
  type ModelRequest,
} from "./contracts.js";

export interface ProviderPrivacyPolicy {
  /** Highest declared classification that this provider deployment may receive. */
  readonly maximumClassification: ModelDataClassification;
  /** Require request-level consent for confidential and restricted content. */
  readonly requireSensitiveContentConsent: boolean;
  /** Detect common credentials and private keys independently of declared classification. */
  readonly rejectDetectedSecrets: boolean;
}

export const PUBLIC_ONLY_PRIVACY_POLICY: Readonly<ProviderPrivacyPolicy> = Object.freeze({
  maximumClassification: "public",
  requireSensitiveContentConsent: true,
  rejectDetectedSecrets: true,
});

const classificationRank: Readonly<Record<ModelDataClassification, number>> = Object.freeze({
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
});

const secretPatterns = Object.freeze([
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret|password|private[_ -]?key)\s*[:=]\s*["']?\S{8,}/iu,
  /\b(?:sk|pk)_(?:live|prod)_[A-Za-z0-9_-]{12,}\b/u,
]);

export function containsLikelySecret(content: string): boolean {
  return secretPatterns.some((pattern) => pattern.test(content));
}

export function enforceProviderPrivacy(request: ModelRequest, policy: ProviderPrivacyPolicy): void {
  if (
    classificationRank[request.dataClassification] >
    classificationRank[policy.maximumClassification]
  ) {
    throw new ModelProviderError(
      "MODEL_PRIVACY_DENIED",
      "The provider is not approved for this data classification.",
    );
  }
  if (
    policy.requireSensitiveContentConsent &&
    classificationRank[request.dataClassification] >= classificationRank.confidential &&
    request.sensitiveContentConsent !== true
  ) {
    throw new ModelProviderError(
      "MODEL_PRIVACY_DENIED",
      "Sensitive-content provider consent is required.",
    );
  }
  if (policy.rejectDetectedSecrets && containsLikelySecret(request.content)) {
    throw new ModelProviderError(
      "MODEL_PRIVACY_DENIED",
      "Potential credentials cannot be sent to a model provider.",
    );
  }
}
