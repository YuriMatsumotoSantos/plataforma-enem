// Type-aware lint tier, deliberately kept OUT of eslint.config.mjs. Turning
// on projectService means ESLint builds a full TypeScript program, which on
// a large codebase is slow enough to break a pre-commit hook and heavy
// enough to exhaust the heap on a small CI runner.
//
// Two config files and two npm scripts (`lint` and `lint:types`), rather
// than one config branching on process.env.CI: branching makes local and CI
// behavior diverge silently for identical code, and reading process.env
// inside a flat config file trips that config's own no-undef rule.
import defaultConfig from "./eslint.config.mjs";

// Burn-down (02-eslint-warning-burndown.md): assigning to a variable
// before exporting also fixed a real bug found while doing it — the
// `files` glob below was "src/**/*", which matches nothing in this
// project (no src/ directory), so the whole type-aware tier never ran
// against a single file. Fixed to the same repo-root pattern used in
// eslint.config.mjs.
const typedConfig = [
  ...defaultConfig,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Every rule here starts at "warn". None of them has a known violation
      // count on a codebase this config has never run against, so none of
      // them gets to fail a build sight unseen. Promote to "error" per rule,
      // once its count is zero.
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/only-throw-error": "warn",
      "@typescript-eslint/return-await": ["warn", "in-try-catch"],
      "@typescript-eslint/await-thenable": "warn",
      "@typescript-eslint/unbound-method": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",
      "@typescript-eslint/restrict-plus-operands": "warn",
      "@typescript-eslint/require-await": "warn",
    },
  },
  {
    // Burn-down decision (02-eslint-warning-burndown.md, decision gate):
    // 248 of the type-aware tier's first-ever real warnings were this one
    // family, all downstream of `await response.json()` returning `any` —
    // a fetch/Response typing fact, not a bug. Every route test does
    // `const body = await response.json(); expect(body.foo)...` against
    // data the same test just inserted, never unchecked user input. Fixing
    // this "properly" means casting every response.json() call across
    // ~15 files for zero real safety gain in test code — re-scoped instead,
    // same call already made for max-statements/max-lines-per-function/
    // max-nested-callbacks/no-non-null-assertion in the fast tier.
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
];

export default typedConfig;
