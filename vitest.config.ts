import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

function source(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: {
      "@verus/contracts": source("./packages/contracts/src/index.ts"),
      "@verus/crypto": source("./packages/crypto/src/index.ts"),
      "@verus/domain": source("./packages/domain/src/index.ts"),
    },
  },
});
