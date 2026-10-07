export interface HostedRequest {
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string | string[] | undefined>>;
  readonly method?: string;
  readonly url?: string;
}

export interface HostedResponse {
  status(code: number): HostedResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

export function secureJson(response: HostedResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("x-content-type-options", "nosniff");
}
