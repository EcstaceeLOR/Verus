export interface ContractIssue {
  readonly path: string;
  readonly keyword: string;
  readonly message: string;
}

export class ContractValidationError extends Error {
  readonly code = "CONTRACT_VALIDATION_FAILED" as const;
  readonly contract: string;
  readonly issues: readonly ContractIssue[];

  constructor(contract: string, issues: readonly ContractIssue[]) {
    super(`The ${contract} contract is invalid.`);
    this.name = "ContractValidationError";
    this.contract = contract;
    this.issues = Object.freeze([...issues]);
  }
}

export class UnsupportedContractVersionError extends Error {
  readonly code = "UNSUPPORTED_CONTRACT_VERSION" as const;
  readonly supportedVersions: readonly string[];

  constructor(supportedVersions: readonly string[]) {
    super("No mutually supported contract version is available.");
    this.name = "UnsupportedContractVersionError";
    this.supportedVersions = Object.freeze([...supportedVersions]);
  }
}
