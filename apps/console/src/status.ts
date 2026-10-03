export type ConnectionState = "idle" | "checking" | "ready" | "unavailable";

export interface StatusCopy {
  readonly label: string;
  readonly message: string;
}

const copy: Readonly<Record<ConnectionState, StatusCopy>> = Object.freeze({
  idle: { label: "Not checked", message: "Check the hosted scanner service." },
  checking: { label: "Checking", message: "Contacting the hosted scanner…" },
  ready: { label: "Ready", message: "The hosted scanner is available." },
  unavailable: {
    label: "Unavailable",
    message: "The hosted scanner could not be reached. Try again shortly.",
  },
});

export function statusCopy(state: ConnectionState): StatusCopy {
  return copy[state];
}
