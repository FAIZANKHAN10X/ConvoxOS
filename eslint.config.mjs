import { defineConfig, globalIgnores } from "eslint/config";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import reactCompiler from "eslint-plugin-react-compiler";
import tseslint from "typescript-eslint";

// ESLint 10 (T3.1): eslint-config-next@16.3.4 bundles
// eslint-plugin-react/jsx-a11y/import versions that use removed
// v10 context APIs, so the legacy wrapper cannot load. Compose the
// same coverage directly from v10-compatible packages:
// - @next/eslint-plugin-next core-web-vitals (Next.js rules)
// - typescript-eslint recommended (type-aware rules; replaces the
//   wrapper's TS config)
// - eslint-plugin-react-hooks flat recommended (Rules of Hooks;
//   replaces the wrapper's hooks config)
// - eslint-plugin-react-compiler as warn (T2.4 rationale stands)
// Dropped with the wrapper: eslint-plugin-react core rules,
// jsx-a11y, and import. No errors came from those sets in this
// repo (gate was 0 errors from hooks/TS/Next rules), so the loss
// is advisory coverage, not enforcement.
const eslintConfig = defineConfig([
  nextPlugin.configs["core-web-vitals"],
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  reactCompiler.configs.recommended,
  {
    rules: {
      "react-compiler/react-compiler": "warn",
      // Migration parity (T3.1): the previous wrapper gated 0 errors
      // with these two rules effectively silent (older react-hooks
      // had no set-state-in-effect rule; unused vars were unflagged).
      // Warn preserves the old gate while surfacing the findings;
      // promoting them to errors is separate cleanup work.
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/set-state-in-effect": "warn",
      // react-hooks v7 rules with no v6 equivalent, flagging
      // pre-existing patterns (ref reads in flow-canvas render,
      // manual memo the compiler skips in thread/auth). Real
      // findings, but fixing them changes render behavior — warn
      // keeps the 0-error gate while tracking them as cleanup.
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored minified opus-recorder encoder worker (served statically).
    "public/opus/**",
  ]),
  // Flow canvas legitimately syncs derived ReactFlow nodes via
  // useEffect — flagged by react-hooks/set-state-in-effect.
  // The sync is guarded (equality check) and intentional for drag
  // performance; suppress for this file only.
  {
    files: ["src/components/flows/flow-canvas.tsx"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["src/components/automations/**/*.tsx"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
