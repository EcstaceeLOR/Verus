export interface WorkerRuntimeConfig {
  readonly databaseUrl: string;
  readonly workspaceId: string;
  readonly policyId: string;
  readonly ruleSet: string;
  readonly secretsDirectory: string;
  readonly sealingMasterKey: string;
  readonly workerId: string;
}

const required = [
  "VERUS_DATABASE_URL",
  "VERUS_WORKER_WORKSPACE_ID",
  "VERUS_WORKER_POLICY_ID",
  "VERUS_WORKER_RULESET_JSON",
  "VERUS_WORKER_SECRETS_DIRECTORY",
  "VERUS_WORKER_SEALING_MASTER_KEY",
  "VERUS_WORKER_ID",
] as const;

/** Parses the worker environment strictly; workers must not start without every security control. */
export function parseWorkerRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerRuntimeConfig {
  for (const key of required) if (!environment[key]) throw new TypeError(`${key} is required.`);
  const workspaceId = environment.VERUS_WORKER_WORKSPACE_ID as string;
  const policyId = environment.VERUS_WORKER_POLICY_ID as string;
  const workerId = environment.VERUS_WORKER_ID as string;
  if (!/^ws_[0-9A-HJKMNP-TV-Z]{26}$/.test(workspaceId))
    throw new TypeError("Invalid worker workspace ID.");
  if (!/^policy_[0-9A-HJKMNP-TV-Z]{26}$/.test(policyId))
    throw new TypeError("Invalid worker policy ID.");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(workerId))
    throw new TypeError("Invalid worker ID.");
  try {
    new URL(environment.VERUS_DATABASE_URL as string);
    JSON.parse(environment.VERUS_WORKER_RULESET_JSON as string);
  } catch {
    throw new TypeError("Worker database URL or detector rules are invalid.");
  }
  const master = environment.VERUS_WORKER_SEALING_MASTER_KEY as string;
  if (!/^[A-Za-z0-9_-]{43}$/.test(master) || Buffer.from(master, "base64url").byteLength !== 32)
    throw new TypeError(
      "VERUS_WORKER_SEALING_MASTER_KEY must be an unpadded base64url 32-byte secret.",
    );
  return Object.freeze({
    databaseUrl: environment.VERUS_DATABASE_URL as string,
    workspaceId,
    policyId,
    ruleSet: environment.VERUS_WORKER_RULESET_JSON as string,
    secretsDirectory: environment.VERUS_WORKER_SECRETS_DIRECTORY as string,
    sealingMasterKey: master,
    workerId,
  });
}
