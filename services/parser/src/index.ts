import { createHash } from "node:crypto";

import { SafeMetricRegistry, StructuredLogger } from "@verus/observability";
import { parse, type DefaultTreeAdapterMap } from "parse5";

export * from "./document.js";
export * from "./isolated-document.js";

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_NORMALIZED_CHARS = 1_000_000;
const MAX_LINKS = 1_000;
const HIDDEN_TAGS = new Set(["noscript", "script", "style", "template"]);
type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
type TextNode = DefaultTreeAdapterMap["textNode"];

export type ParsedFormat = "atom" | "html" | "rss" | "text";
export interface SourceLocation {
  readonly endOffset: number;
  readonly startOffset: number;
}
export interface ParsedLink {
  readonly href: string;
  readonly location?: SourceLocation;
  readonly text: string;
}
export interface SuspiciousRegion {
  readonly location?: SourceLocation;
  readonly reason: "hidden_attribute" | "hidden_css" | "inactive_content";
  readonly tag: string;
  readonly text: string;
}
export interface ParsedRepresentation {
  readonly content: string;
  readonly digest: string;
}
export interface ParsedDocument {
  readonly format: ParsedFormat;
  readonly links: readonly ParsedLink[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly normalized: ParsedRepresentation;
  readonly raw: ParsedRepresentation;
  readonly suspiciousRegions: readonly SuspiciousRegion[];
  readonly title?: string;
}
export class ParseFailure extends Error {
  constructor(
    readonly code: "INPUT_LIMIT" | "UNSUPPORTED_ENCODING",
    message: string,
  ) {
    super(message);
    this.name = "ParseFailure";
  }
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
function attr(element: Element, name: string): string | undefined {
  return element.attrs.find((candidate) => candidate.name === name)?.value;
}
function location(node: Node): SourceLocation | undefined {
  const source = node.sourceCodeLocation;
  return source === undefined || source === null
    ? undefined
    : { endOffset: source.endOffset, startOffset: source.startOffset };
}
function isElement(node: Node): node is Element {
  return "tagName" in node;
}
function isText(node: Node): node is TextNode {
  return node.nodeName === "#text";
}
function normalise(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
function textContent(node: Node): string {
  if (isText(node)) return node.value;
  if (!("childNodes" in node)) return "";
  return node.childNodes.map(textContent).join("");
}
function hiddenReason(element: Element): SuspiciousRegion["reason"] | undefined {
  if (HIDDEN_TAGS.has(element.tagName)) return "inactive_content";
  if (attr(element, "hidden") !== undefined || attr(element, "aria-hidden") === "true")
    return "hidden_attribute";
  const style = attr(element, "style")?.replace(/\s+/gu, "").toLowerCase();
  if (style?.includes("display:none") || style?.includes("visibility:hidden")) return "hidden_css";
  return undefined;
}
function detectFormat(raw: string, declared?: string): ParsedFormat {
  const probe = raw.trimStart().slice(0, 512).toLowerCase();
  if (declared?.includes("rss") || /^<rss[\s>]/u.test(probe)) return "rss";
  if (declared?.includes("atom") || /^<feed[\s>]/u.test(probe)) return "atom";
  if (declared?.startsWith("text/plain")) return "text";
  return /<\/?[a-z][^>]*>/iu.test(probe) ? "html" : "text";
}
function decode(input: Uint8Array | string, encoding: string): string {
  if (typeof input === "string") return input;
  const normalized = encoding.toLowerCase();
  if (!["utf-8", "utf8", "utf-16le", "utf-16be"].includes(normalized))
    throw new ParseFailure("UNSUPPORTED_ENCODING", `Unsupported input encoding: ${encoding}.`);
  return new TextDecoder(normalized, { fatal: true }).decode(input);
}

export function parseUntrustedContent(
  input: Readonly<{
    bytes: Uint8Array | string;
    contentType?: string;
    encoding?: "utf-8" | "utf-16be" | "utf-16le" | "utf8";
  }>,
): ParsedDocument {
  const byteLength =
    typeof input.bytes === "string" ? Buffer.byteLength(input.bytes) : input.bytes.byteLength;
  if (byteLength > MAX_INPUT_BYTES)
    throw new ParseFailure("INPUT_LIMIT", `Parser input exceeds ${MAX_INPUT_BYTES} bytes.`);
  const rawContent = decode(input.bytes, input.encoding ?? "utf-8");
  const raw = Object.freeze({ content: rawContent, digest: digest(rawContent) });
  const format = detectFormat(rawContent, input.contentType);
  if (format === "text") {
    const content = normalise(rawContent).slice(0, MAX_NORMALIZED_CHARS);
    return Object.freeze({
      format,
      links: Object.freeze([]),
      metadata: Object.freeze({}),
      normalized: Object.freeze({ content, digest: digest(content) }),
      raw,
      suspiciousRegions: Object.freeze([]),
    });
  }
  const root = parse(rawContent, { sourceCodeLocationInfo: true });
  const metadata: Record<string, string> = {};
  const links: ParsedLink[] = [];
  const suspiciousRegions: SuspiciousRegion[] = [];
  const visible: string[] = [];
  let title: string | undefined;
  const visit = (node: Node, inheritedHidden = false): void => {
    if (isText(node)) {
      if (!inheritedHidden) visible.push(node.value);
      return;
    }
    if (!("childNodes" in node)) return;
    if (!isElement(node)) {
      node.childNodes.forEach((child) => visit(child, inheritedHidden));
      return;
    }
    const reason = hiddenReason(node);
    const hidden = inheritedHidden || reason !== undefined;
    const text = normalise(textContent(node));
    if (reason !== undefined && text !== "") {
      const source = location(node);
      suspiciousRegions.push({
        ...(source === undefined ? {} : { location: source }),
        reason,
        tag: node.tagName,
        text,
      });
    }
    if (node.tagName === "meta") {
      const key = attr(node, "name") ?? attr(node, "property") ?? attr(node, "http-equiv");
      const value = attr(node, "content");
      if (key !== undefined && value !== undefined && metadata[key.toLowerCase()] === undefined)
        metadata[key.toLowerCase()] = value;
    }
    if (node.tagName === "title" && title === undefined && text !== "") title = text;
    if (node.tagName === "link" && attr(node, "rel")?.toLowerCase() === "canonical") {
      const href = attr(node, "href");
      if (href !== undefined) metadata.canonical = href;
    }
    if (node.tagName === "a" && !hidden && links.length < MAX_LINKS) {
      const href = attr(node, "href");
      if (href !== undefined) {
        const source = location(node);
        links.push({ href, ...(source === undefined ? {} : { location: source }), text });
      }
    }
    node.childNodes.forEach((child) => visit(child, hidden));
  };
  visit(root);
  const content = normalise(visible.join(" ")).slice(0, MAX_NORMALIZED_CHARS);
  return Object.freeze({
    format,
    links: Object.freeze(links),
    metadata: Object.freeze(metadata),
    normalized: Object.freeze({ content, digest: digest(content) }),
    raw,
    suspiciousRegions: Object.freeze(suspiciousRegions),
    ...(title === undefined ? {} : { title }),
  });
}

/** Creates the instrumented parser boundary used by worker jobs. */
export function createUntrustedContentParser(
  options: Readonly<{ logger?: StructuredLogger; metrics?: SafeMetricRegistry }> = {},
): Readonly<{ parse: typeof parseUntrustedContent }> {
  const logger = options.logger ?? new StructuredLogger("verus-parser");
  const metrics = options.metrics ?? new SafeMetricRegistry();
  return Object.freeze({
    parse(input) {
      const startedAt = performance.now();
      try {
        const result = parseUntrustedContent(input);
        const durationMs = performance.now() - startedAt;
        metrics.observe(
          "verus_scan_duration_ms",
          { outcome: "success", stage: "parser" },
          durationMs,
        );
        logger.emit({
          component: "parser",
          durationMs,
          event: "content.parsed",
          level: "info",
          outcome: "success",
        });
        return result;
      } catch (error) {
        const durationMs = performance.now() - startedAt;
        const errorCode = error instanceof ParseFailure ? error.code : "PARSER_FAILURE";
        metrics.increment("verus_failures_total", { component: "parser", error_code: errorCode });
        metrics.observe(
          "verus_scan_duration_ms",
          { outcome: "failure", stage: "parser" },
          durationMs,
        );
        logger.emit({
          component: "parser",
          durationMs,
          errorCode,
          event: "content.parse_failed",
          level: "warn",
          outcome: "failure",
        });
        throw error;
      }
    },
  });
}
