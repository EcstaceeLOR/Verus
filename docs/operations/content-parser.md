# Content parser operations

The parser is a no-network sandbox boundary. Give it a read-only object capability and pass the
object bytes to `createUntrustedContentParser`; it must never receive browser, network, database, or
credential capabilities.

It accepts UTF-8 and UTF-16 input up to 5 MiB. HTML is parsed with source locations but scripts,
styles, templates, and hidden nodes are excluded from normalized context. Those regions are emitted
as suspicious findings for policy review. RSS and Atom are parsed with the same non-executing HTML
tree parser, and malformed markup is tolerated deterministically.

Keep raw and normalized representations in separate object keys and retain their SHA-256 digests
with the evidence record. On `INPUT_LIMIT`, `UNSUPPORTED_ENCODING`, or an unexpected parser error,
record a failed parse job and do not make the source eligible for context assembly.

For PDFs, DOCX, XLSX, and PPTX, call `createIsolatedDocumentParser`, not the low-level extractor. It
creates a new memory-capped worker per document, applies a 25 MiB input limit, a 50 MiB expanded
Office limit, 2,000 ZIP-entry limit, 250-page PDF limit, and 20-second deadline. A timeout, worker
failure, malformed file, or page extraction failure yields an incomplete result. Workers must not
publish any text from incomplete results. OCR is opt-in and OCR-derived text must remain labeled in
the evidence record.

## Canonicalization policy

Run `createCanonicalizer` before detection or policy evaluation. Verus decodes declared UTF-8 or
UTF-16LE input, applies Unicode NFKC, removes zero-width, bidi, and non-printing control characters,
and replaces the documented Cyrillic/Latin confusable set with an ASCII skeleton. Each non-lossless
step has a transformation-map entry back to the original UTF-16 source offset and produces a
finding. CSS-hidden parser regions, metadata values, and disagreement between visual and canonical
text are also findings; none are silently merged into trusted context.

Store the digest of the received byte sequence separately from the digest of canonical UTF-8 text.
Canonicalizing canonical text is idempotent. Unsupported or undecodable input must fail closed and
remain available only as quarantined raw evidence.
