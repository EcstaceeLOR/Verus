export const healthPayload = Object.freeze({
  service: "verus-api",
  status: "ok",
  version: "0.0.0",
});

export function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError("VERUS_API_PORT must be an integer from 1 to 65535");
  }
  return port;
}
