// Fast lint tier. Everything here runs without type information, which is
// what keeps it quick enough for a pre-commit hook. The rules that need the
// type checker live in eslint.typed.config.mjs and run on their own script.
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import importX from "eslint-plugin-import-x";
import tseslint from "typescript-eslint";

import quality from "./eslint-rules/index.cjs";

const eslintConfig = defineConfig([
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        crypto: "readonly",
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.strict,

  // Already-adopted framework preset for this project (Next.js), not the
  // template's raw eslint-plugin-next block.
  ...nextVitals,
  ...nextTs,

  {
    // import-x resolves the "@/*" path alias (tsconfig.json) so
    // no-unresolved is accurate. This project has no src/ directory — real
    // source root is the repo root itself, split across app/, lib/, db/.
    plugins: { "import-x": importX },
    settings: {
      "import-x/resolver-next": [createTypeScriptImportResolver()],
    },
    rules: {
      "import-x/no-unresolved": "error",
      "import-x/no-duplicates": "error",
      "import-x/no-restricted-paths": [
        "error",
        {
          zones: [
            // Pages/components fetch data through API routes, never the
            // Drizzle client or the raw schema directly — that boundary is
            // what every route handler in this project already enforces by
            // convention (requireUser + Drizzle queries live in app/api/**).
            { target: "./app/**/*.tsx", from: "./lib/db.ts" },
            { target: "./app/**/*.tsx", from: "./db/schema.ts" },
          ],
        },
      ],
    },
  },
  {
    // Whole repo minus generated/vendored/tooling directories (globalIgnores
    // below) — this project has no single src/ root to scope a positive
    // glob to instead.
    files: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"],
    plugins: { quality },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-var": "error",
      "prefer-const": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Size/complexity budget: "warn" on purpose, a conversation starter,
      // not a gate. Promote a given one to "error" once its count hits zero.
      complexity: ["warn", 12],
      "max-depth": ["warn", 4],
      "max-statements": ["warn", 20],
      "max-params": ["warn", 4],
      "max-lines-per-function": [
        "warn",
        { max: 150, skipBlankLines: true, skipComments: true },
      ],
      "max-nested-callbacks": ["warn", 3],
      "quality/max-lines": "error",
      // Burn-down (02-eslint-warning-burndown.md): the 3 measured
      // violations (webhook route x2, Header.tsx x1) now go through
      // lib/logger.ts — count is 0, promoted to "error".
      "quality/no-direct-console": ["error", { logger: "lib/logger.ts" }],
      "quality/no-direct-data-access": [
        "error",
        {
          modules: ["@/lib/db"],
          bindings: ["db"],
          layers: ["/app/"],
          extensions: [".tsx"],
        },
      ],
    },
  },
  {
    // Same file budget for test files, at "warn" — placed after the "error"
    // block above for the same flat-config ordering reason documented there.
    files: [
      "**/*.test.{ts,tsx}",
      "**/{__tests__,__mocks__,fixtures,mocks}/**/*.{ts,tsx}",
    ],
    plugins: { quality },
    rules: {
      "quality/max-lines": ["warn", { includeTests: true }],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      // These fire heavily on describe/it nesting and long arrange sections
      // without pointing at a real problem — this project's own test suite
      // convention (real Postgres, no mocks) produces long, flat setup
      // blocks that aren't a complexity smell.
      "max-statements": "off",
      "max-lines-per-function": "off",
      "max-nested-callbacks": "off",
      "import-x/no-restricted-paths": "off",
      // Measured (Step 6): 20 violations, all in tests, all the
      // established `rows[0]!.id`-style pattern for "this array is
      // non-empty by construction" right after inserting the row this
      // same test just created — a real, accepted pattern here, not
      // unchecked-null risk creeping into application code.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    // Route handlers ARE this project's data-access layer (Next.js API
    // routes, no separate repository/service layer exists or is planned —
    // see CLAUDE.md) — quality/no-direct-data-access's `layers: ["/app/"]`
    // matches by substring, so it doesn't distinguish app/api/**/*.ts from
    // a page component under the same tree. Placed after the block that
    // turns the rule on, same flat-config ordering reason as the other
    // off-overrides in this file.
    files: ["app/api/**/*.ts"],
    rules: {
      "quality/no-direct-data-access": "off",
    },
  },
  {
    // The log adapter itself. Must come after the block that turns the rule
    // on — flat config applies the later block's rules last, so an "off"
    // placed earlier would be silently overridden.
    files: ["lib/logger.ts"],
    rules: {
      "quality/no-direct-console": "off",
    },
  },
  {
    files: ["eslint-rules/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { module: "readonly", require: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  globalIgnores([
    ".claude/**",
    // Every prior subsystem's git worktree, several still on disk
    // (Permission-denied cleanup is a known, accepted OneDrive quirk on
    // this machine). Without this, linting the whole repo also lints every
    // worktree's own full copy of app/lib/db — multiplying every count by
    // however many stale worktrees happen to be sitting around, the exact
    // trap that already hit `npm test`/`npm run lint` earlier this session.
    ".worktrees/**",
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "**/*.tsbuildinfo",
    "package-lock.json",
    "next-env.d.ts",
    // Generated Drizzle migration SQL metadata, not application code.
    "drizzle/**",
    // Local CLI tooling (ingestion pipeline, seed scripts), run by hand a
    // few times a year, never deployed. console.log/warn/error IS the
    // correct interface for a CLI script printing its own progress — not a
    // violation of the same rule that matters for a web server's routes.
    "scripts/**",
  ]),
]);

export default eslintConfig;
