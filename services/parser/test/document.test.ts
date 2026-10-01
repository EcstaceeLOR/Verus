import { describe, expect, it } from "vitest";

import { DOCUMENT_LIMITS, DocumentParseFailure, extractDocument } from "../src/document.js";

function storedZip(entries: readonly Readonly<{ name: string; value: string }>[]): Uint8Array {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const value = Buffer.from(entry.value);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(value.length, 18);
    local.writeUInt32LE(value.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, value);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(value.length, 20);
    directory.writeUInt32LE(value.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += local.length + name.length + value.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function singleBlankPagePdf(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}

describe("isolated document extraction", () => {
  it("extracts text from a bounded DOCX archive with citation locations", async () => {
    const extraction = await extractDocument({
      bytes: storedZip([
        {
          name: "word/document.xml",
          value: "<w:document><w:t>Quarterly result</w:t></w:document>",
        },
      ]),
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(extraction).toMatchObject({ complete: true, format: "docx" });
    expect(extraction.text[0]).toMatchObject({
      ocrDerived: false,
      text: "Quarterly result",
      location: { part: "word/document.xml" },
    });
  });

  it("reports malformed PDFs as incomplete without exposing partial allowed context", async () => {
    const extraction = await extractDocument({
      bytes: Buffer.from("%PDF-malformed"),
      contentType: "application/pdf",
    });
    expect(extraction).toEqual({
      complete: false,
      format: "pdf",
      problems: [{ code: "EXTRACTION_FAILED", message: "Document extraction failed safely." }],
      text: [],
    });
  });

  it("uses OCR only when explicitly supplied and marks all derived text", async () => {
    const extraction = await extractDocument({
      bytes: singleBlankPagePdf(),
      contentType: "application/pdf",
      ocr: {
        recognize: async ({ page }) => [
          {
            location: { characterEnd: 3, characterStart: 0, page, part: "page-1" },
            ocrDerived: false,
            text: "OCR",
          },
        ],
      },
    });
    expect(extraction).toMatchObject({
      complete: true,
      text: [expect.objectContaining({ ocrDerived: true, text: "OCR" })],
    });
  });

  it("rejects oversized and unsupported document inputs before extraction", async () => {
    await expect(
      extractDocument({
        bytes: new Uint8Array(DOCUMENT_LIMITS.maxBytes + 1),
        contentType: "application/pdf",
      }),
    ).rejects.toBeInstanceOf(DocumentParseFailure);
    await expect(
      extractDocument({ bytes: new Uint8Array(), contentType: "image/png" }),
    ).rejects.toBeInstanceOf(DocumentParseFailure);
  });
});
