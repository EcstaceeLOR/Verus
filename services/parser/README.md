# Parser service

The parser converts untrusted HTML, RSS, Atom, and plain text into bounded, deterministic
representations. It does not fetch links, execute scripts, load active content, or make network
calls. A parser failure must never produce allowed context.

`parseUntrustedContent` returns separately addressable raw and normalized representations, visible
links with source offsets, first-wins metadata, and hidden or inactive regions for later policy
inspection. Inputs are capped at 5 MiB and normalized content at 1 million characters.

Use `createUntrustedContentParser` in production workers. It records structured success/failure
events and bounded parser-duration/failure metrics without logging document contents.

For PDFs and Office files, use `createIsolatedDocumentParser`. It creates a fresh worker with a 256
MiB old-generation ceiling and a 20-second deadline for every document. The worker receives only
bytes and a declared MIME type. PDF text retains page and approximate bounding-box locations; Office
text retains its archive part and character range. Incomplete extraction is never a success. OCR is
an explicit `OcrEngine` path in `extractDocument`, and every OCR result is marked `ocrDerived`;
production OCR adapters must run in their own equivalent bounded worker.
