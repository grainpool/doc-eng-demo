import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "estate/**",
      "**/worker-configuration.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Invariant I1 (Phase 08): no user-visible literal in relay-web JSX —
    // every string renders through t() from the copy registry. A JSX text
    // node containing a letter fails the LINT (the vitest scan in
    // no-literal-copy.test.ts is the second, independent net).
    files: ["packages/relay-web/src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXText[value=/[A-Za-z]/]",
          message:
            "User-visible literal in JSX. Render copy through t('<copy id>') from the estate registry (constraints.md AP8 / invariant I1).",
        },
      ],
    },
  },
  {
    // Invariant I13: Concord must not import Relay implementation packages.
    files: ["packages/concord-*/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["*relay-api*", "*relay-web*", "*relay-cli*"],
              message:
                "Concord may not import Relay implementation packages — only @relay/contracts and the two frozen HTTP endpoints (invariant I13).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", fetch: "readonly" },
    },
  },
);
