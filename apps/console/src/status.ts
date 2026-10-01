export type ConnectionState = "idle" | "checking" | "ready" | "unavailable";

export interface StatusCopy {
  readonly label: string;
  readonly message: string;
}

const copy: Readonly<Record<ConnectionState, StatusCopy>> = Object.freeze({
  idle: { label: "Not checked", message: "Check that your local Verus API is available." },
  checking: { label: "Checking", message: "Contacting the local API…" },
  ready: { label: "Connected", message: "Your Verus workspace is ready." },
  unavailable: {
    label: "Unavailable",
    message: "Start the API, then check the connection again.",
  },
});

export function statusCopy(state: ConnectionState): StatusCopy {
  return copy[state];
}
