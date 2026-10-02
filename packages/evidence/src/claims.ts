export type ClaimType =
  "revenue" | "earnings" | "listing" | "delisting" | "maintenance" | "market_status";
export interface CandidateClaim {
  readonly id: string;
  readonly type: ClaimType;
  readonly subject: Readonly<{
    entity: string;
    symbol?: string;
    ambiguity: "resolved" | "ambiguous";
  }>;
  readonly value?: number;
  readonly currency?: string;
  readonly period?: string;
  readonly occurredAt?: string;
  readonly source: Readonly<{ digest: string; start: number; end: number; text: string }>;
  readonly verification: "candidate";
}
export function createCandidateClaim(input: CandidateClaim): Readonly<CandidateClaim> {
  if (
    !input.id ||
    input.source.start < 0 ||
    input.source.end <= input.source.start ||
    input.source.text.length !== input.source.end - input.source.start
  )
    throw new Error("CLAIM_SPAN_INVALID");
  if (!input.subject.entity || input.verification !== "candidate")
    throw new Error("CLAIM_SCHEMA_INVALID");
  return Object.freeze({
    ...input,
    subject: Object.freeze({ ...input.subject }),
    source: Object.freeze({ ...input.source }),
  });
}
export function extractRevenueCandidate(
  input: Readonly<{ id: string; content: string; digest: string; entity: string; symbol?: string }>,
): Readonly<CandidateClaim | undefined> {
  const match = /revenue\s+(?:was|of)\s+\$?(\d+(?:\.\d+)?)\s*(million|billion)?/iu.exec(
    input.content,
  );
  if (!match || match.index === undefined) return undefined;
  const text = match[0];
  const multiplier =
    match[2] === "billion" ? 1_000_000_000 : match[2] === "million" ? 1_000_000 : 1;
  return createCandidateClaim({
    id: input.id,
    type: "revenue",
    subject: {
      entity: input.entity,
      ...(input.symbol ? { symbol: input.symbol } : {}),
      ambiguity: input.symbol ? "resolved" : "ambiguous",
    },
    value: Number(match[1]) * multiplier,
    currency: "USD",
    source: { digest: input.digest, start: match.index, end: match.index + text.length, text },
    verification: "candidate",
  });
}
