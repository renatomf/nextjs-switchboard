import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Trigger.dev's bundled task output, written by `trigger.dev dev` and
    // `deploy`. It only exists after a worker has run, which is why linting
    // passed without it — and why it fails as soon as anyone starts the worker.
    ".trigger/**",
  ]),
]);

export default eslintConfig;
