export interface SecTransport {
  get(
    url: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<Readonly<{ status: number; body: string; retrievedAt: string }>>;
}
export interface SecFiling {
  readonly cik: string;
  readonly accession: string;
  readonly form: string;
  readonly filedAt: string;
  readonly amendment: boolean;
  readonly authoritativeUrl: string;
  readonly anchors: readonly string[];
  readonly freshness: "current" | "unavailable";
}
const accession = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/;
export class SecEdgarConnector {
  readonly #transport: SecTransport;
  readonly #userAgent: string;
  #nextRequestAt = 0;
  constructor(transport: SecTransport, userAgent: string) {
    if (!/^.+@.+/u.test(userAgent)) throw new Error("SEC_USER_AGENT_REQUIRED");
    this.#transport = transport;
    this.#userAgent = userAgent;
  }
  async filing(cik: string, accessionNumber: string): Promise<Readonly<SecFiling>> {
    if (!/^\d{10}$/u.test(cik) || !accession.test(accessionNumber))
      throw new Error("SEC_IDENTIFIER_INVALID");
    const now = Date.now();
    if (now < this.#nextRequestAt) throw new Error("SEC_RATE_LIMITED");
    this.#nextRequestAt = now + 100;
    const path = accessionNumber.replace(/-/gu, "");
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${path}/${accessionNumber}.txt`;
    try {
      const response = await this.#transport.get(url, {
        "User-Agent": this.#userAgent,
        Accept: "text/plain",
      });
      if (response.status !== 200) throw new Error("SEC_UNAVAILABLE");
      const form = response.body.match(/<TYPE>([^\r\n<]+)/u)?.[1]?.trim() ?? "UNKNOWN";
      const filedAt = response.body.match(/<FILING-DATE>(\d{8})/u)?.[1] ?? "UNKNOWN";
      const anchors = [...response.body.matchAll(/<DOCUMENT>/gu)].map(
        (_, index) => `document:${index + 1}`,
      );
      return Object.freeze({
        cik,
        accession: accessionNumber,
        form,
        filedAt,
        amendment: /\/A$/u.test(form),
        authoritativeUrl: url,
        anchors: Object.freeze(anchors),
        freshness: "current",
      });
    } catch {
      return Object.freeze({
        cik,
        accession: accessionNumber,
        form: "UNKNOWN",
        filedAt: "UNKNOWN",
        amendment: false,
        authoritativeUrl: url,
        anchors: Object.freeze([]),
        freshness: "unavailable",
      });
    }
  }
}
