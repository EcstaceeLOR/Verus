import { parentPort } from "node:worker_threads";

import { extractDocument } from "./document.js";

if (parentPort === null) throw new Error("Document parser worker requires a parent port.");

parentPort.on("message", (input: Readonly<{ bytes: Uint8Array; contentType: string }>) => {
  void extractDocument(input)
    .then((result) => parentPort?.postMessage({ result }))
    .catch((error: unknown) =>
      parentPort?.postMessage({
        error:
          error instanceof Error
            ? { code: "DOCUMENT_PARSE_FAILED", message: error.message }
            : { code: "DOCUMENT_PARSE_FAILED", message: "Document parser failed safely." },
      }),
    );
});
