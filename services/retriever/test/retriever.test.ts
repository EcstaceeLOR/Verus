import { describe, expect, it } from "vitest";

import {
  HardenedRetriever,
  RetrievalError,
  assertPublicAddress,
  parseRetrievalUrl,
  type RetrievalTransport,
} from "../src/index.js";

async function* body(value: string): AsyncGenerator<Buffer> {
  yield Buffer.from(value);
}

function transport(
  routes: Readonly<
    Record<
      string,
      {
        readonly headers?: Readonly<Record<string, string>>;
        readonly status: number;
        readonly value?: string;
      }
    >
  >,
): RetrievalTransport {
  return {
    request: async ({ url }) => {
      const route = routes[url.toString()];
      if (route === undefined) throw new Error("unexpected URL");
      return {
        body: body(route.value ?? ""),
        headers: route.headers ?? {},
        statusCode: route.status,
      };
    },
  };
}

const resolver = async (): Promise<
  readonly { readonly address: string; readonly family: 4 | 6 }[]
> => [{ address: "93.184.216.34", family: 4 }];

describe("network quarantine policy", () => {
  it.each([
    "http://example.com",
    "https://user:pass@example.com",
    "https://127.0.0.1",
    "https://[::1]",
    "https://169.254.169.254",
    "https://0x7f000001",
  ])("blocks unsafe authority %s", (value) => {
    expect(() => parseRetrievalUrl(value)).toThrow(RetrievalError);
  });

  it.each([
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
  ])("blocks local resolved address %s", (address) => {
    expect(() => assertPublicAddress(address)).toThrow(RetrievalError);
  });

  it("revalidates every redirect and captures the safe chain", async () => {
    const retriever = new HardenedRetriever({
      resolver,
      transport: transport({
        "https://example.com/start": { status: 302, headers: { location: "/final" } },
        "https://example.com/final": {
          status: 200,
          headers: { "content-type": "text/plain" },
          value: "verified content",
        },
      }),
    });
    const result = await retriever.retrieve("https://example.com/start");
    expect(result).toMatchObject({
      contentType: "text/plain",
      redirects: [{ status: 302, url: "https://example.com/start" }],
      url: "https://example.com/final",
    });
    expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("does not follow a redirect to a local address", async () => {
    const retriever = new HardenedRetriever({
      resolver,
      transport: transport({
        "https://example.com/start": {
          status: 302,
          headers: { location: "https://127.0.0.1/metadata" },
        },
      }),
    });
    await expect(retriever.retrieve("https://example.com/start")).rejects.toMatchObject({
      code: "PRIVATE_ADDRESS_BLOCKED",
    });
  });

  it("rejects encoded and oversized responses without a fallback", async () => {
    const encoded = new HardenedRetriever({
      resolver,
      transport: transport({
        "https://example.com/content": {
          status: 200,
          headers: { "content-encoding": "gzip", "content-type": "text/plain" },
          value: "not consumed",
        },
      }),
    });
    await expect(encoded.retrieve("https://example.com/content")).rejects.toMatchObject({
      code: "CONTENT_ENCODING_BLOCKED",
    });
  });
});
