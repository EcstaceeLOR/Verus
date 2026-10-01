import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/coverage/**", "**/dist/**", "**/node_modules/**", "**/.turbo/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
    },
  },
  {
    files: ["apps/console/src/**/*.ts", "apps/console/src/**/*.tsx"],
    languageOptions: {
      globals: globals.browser,
    },
  },
);
