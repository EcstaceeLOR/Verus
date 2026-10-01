import { XMLParser } from "fast-xml-parser";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import yauzl from "yauzl";

export const DOCUMENT_LIMITS = Object.freeze({
  maxBytes: 25 * 1024 * 1024,
  maxOfficeEntries: 2_000,
  maxOfficeUncompressedBytes: 50 * 1024 * 1024,
  maxPages: 250,
  timeoutMs: 20_000,
});

export interface CitationLocation {
  readonly boundingBox?: readonly [number, number, number, number];
  readonly characterEnd: number;
  readonly characterStart: number;
  readonly page?: number;
  readonly part: string;
}
export interface ExtractedText {
  readonly location: CitationLocation;
  readonly ocrDerived: boolean;
  readonly text: string;
}
export interface ExtractionProblem {
  readonly code: string;
  readonly message: string;
}
export interface DocumentExtraction {
  readonly complete: boolean;
  readonly format: "docx" | "pdf" | "pptx" | "xlsx";
  readonly problems: readonly ExtractionProblem[];
  readonly text: readonly ExtractedText[];
}
export interface OcrEngine {
  recognize(
    input: Readonly<{ bytes: Uint8Array; page: number }>,
  ): Promise<readonly ExtractedText[]>;
}
export class DocumentParseFailure extends Error {
  constructor(
    readonly code: "DOCUMENT_LIMIT" | "UNSUPPORTED_DOCUMENT",
    message: string,
  ) {
    super(message);
    this.name = "DocumentParseFailure";
  }
}

function formatFor(contentType: string): DocumentExtraction["format"] {
  const normalized = contentType.toLowerCase().split(";", 1)[0] ?? "";
  if (normalized === "application/pdf") return "pdf";
  if (normalized.includes("wordprocessingml")) return "docx";
  if (normalized.includes("spreadsheetml")) return "xlsx";
  if (normalized.includes("presentationml")) return "pptx";
  throw new DocumentParseFailure(
    "UNSUPPORTED_DOCUMENT",
    `Unsupported document content type: ${contentType}.`,
  );
}
function bounded<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("Document extraction timeout.")),
      DOCUMENT_LIMITS.timeoutMs,
    );
  });
  return Promise.race([operation, timeoutResult]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}
function textValue(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(textValue);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(textValue);
  return [];
}
function officeParts(format: DocumentExtraction["format"]): RegExp {
  if (format === "docx") return /^word\/(document|header\d+|footer\d+)\.xml$/u;
  if (format === "xlsx") return /^(xl\/sharedStrings|xl\/worksheets\/sheet\d+)\.xml$/u;
  return /^ppt\/slides\/slide\d+\.xml$/u;
}
async function officeEntries(
  bytes: Uint8Array,
  pattern: RegExp,
): Promise<readonly Readonly<{ name: string; content: string }>[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      Buffer.from(bytes),
      { lazyEntries: true, validateEntrySizes: true },
      (error, archive) => {
        if (error !== null || archive === undefined) {
          reject(error ?? new Error("Invalid office archive."));
          return;
        }
        const found: { name: string; content: string }[] = [];
        let entries = 0;
        let expanded = 0;
        archive.on("error", reject);
        archive.on("entry", (entry) => {
          entries += 1;
          expanded += entry.uncompressedSize;
          if (
            entries > DOCUMENT_LIMITS.maxOfficeEntries ||
            expanded > DOCUMENT_LIMITS.maxOfficeUncompressedBytes
          ) {
            archive.close();
            reject(
              new DocumentParseFailure(
                "DOCUMENT_LIMIT",
                "Office archive exceeds extraction limits.",
              ),
            );
            return;
          }
          if (!pattern.test(entry.fileName)) {
            archive.readEntry();
            return;
          }
          archive.openReadStream(entry, (streamError, stream) => {
            if (streamError !== null || stream === undefined) {
              archive.close();
              reject(streamError ?? new Error("Office entry unavailable."));
              return;
            }
            const chunks: Buffer[] = [];
            stream.on("data", (chunk: Buffer) => chunks.push(chunk));
            stream.on("error", reject);
            stream.on("end", () => {
              found.push({ name: entry.fileName, content: Buffer.concat(chunks).toString("utf8") });
              archive.readEntry();
            });
          });
        });
        archive.on("end", () =>
          resolve(found.sort((left, right) => left.name.localeCompare(right.name))),
        );
        archive.readEntry();
      },
    );
  });
}
async function extractOffice(
  bytes: Uint8Array,
  format: Exclude<DocumentExtraction["format"], "pdf">,
): Promise<DocumentExtraction> {
  const parsed = new XMLParser({ ignoreAttributes: true, processEntities: false });
  const parts = await officeEntries(bytes, officeParts(format));
  const text: ExtractedText[] = [];
  let offset = 0;
  for (const part of parts) {
    const value = textValue(parsed.parse(part.content)).join(" ").replace(/\s+/gu, " ").trim();
    if (value === "") continue;
    text.push({
      location: { characterEnd: offset + value.length, characterStart: offset, part: part.name },
      ocrDerived: false,
      text: value,
    });
    offset += value.length + 1;
  }
  return Object.freeze({
    complete: true,
    format,
    problems: Object.freeze([]),
    text: Object.freeze(text),
  });
}
async function extractPdf(bytes: Uint8Array, ocr?: OcrEngine): Promise<DocumentExtraction> {
  // pdf.js rejects Buffer subclasses; copying also detaches extraction from the caller's mutable view.
  const loading = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    stopAtErrors: true,
  });
  const pdf = await loading.promise;
  const problems: ExtractionProblem[] = [];
  const text: ExtractedText[] = [];
  let offset = 0;
  const pageCount = Math.min(pdf.numPages, DOCUMENT_LIMITS.maxPages);
  if (pdf.numPages > DOCUMENT_LIMITS.maxPages)
    problems.push({ code: "PAGE_LIMIT", message: "Document exceeded the page extraction limit." });
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    try {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const fragments = content.items
        .filter((item): item is typeof item & { str: string; transform: number[] } => "str" in item)
        .filter((item) => item.str.trim() !== "");
      for (const fragment of fragments) {
        const value = fragment.str;
        const [x, y] = fragment.transform.slice(4, 6);
        text.push({
          location: {
            boundingBox: [x ?? 0, y ?? 0, x ?? 0, y ?? 0],
            characterEnd: offset + value.length,
            characterStart: offset,
            page: pageNumber,
            part: `page-${pageNumber}`,
          },
          ocrDerived: false,
          text: value,
        });
        offset += value.length + 1;
      }
      if (fragments.length === 0 && ocr !== undefined) {
        const derived = await ocr.recognize({ bytes, page: pageNumber });
        text.push(...derived.map((entry) => ({ ...entry, ocrDerived: true })));
      }
    } catch {
      problems.push({
        code: "PAGE_EXTRACTION_FAILED",
        message: `Page ${pageNumber} could not be extracted.`,
      });
    }
  }
  await pdf.destroy();
  return Object.freeze({
    complete: problems.length === 0,
    format: "pdf",
    problems: Object.freeze(problems),
    text: Object.freeze(text),
  });
}

/** Extracts documents under deterministic byte, archive, page, and wall-clock budgets. */
export async function extractDocument(
  input: Readonly<{ bytes: Uint8Array; contentType: string; ocr?: OcrEngine }>,
): Promise<DocumentExtraction> {
  if (input.bytes.byteLength > DOCUMENT_LIMITS.maxBytes)
    throw new DocumentParseFailure("DOCUMENT_LIMIT", "Document exceeds extraction byte limit.");
  const format = formatFor(input.contentType);
  try {
    return await bounded(
      format === "pdf" ? extractPdf(input.bytes, input.ocr) : extractOffice(input.bytes, format),
    );
  } catch (error) {
    if (error instanceof DocumentParseFailure) throw error;
    return Object.freeze({
      complete: false,
      format,
      problems: Object.freeze([
        { code: "EXTRACTION_FAILED", message: "Document extraction failed safely." },
      ]),
      text: Object.freeze([]),
    });
  }
}
