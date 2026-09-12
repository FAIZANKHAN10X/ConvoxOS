import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactCompiler from "eslint-plugin-react-compiler";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // T2.4: surface React Compiler violations (reactCompiler: true
  // in next.config.ts). Warn (not error): pre-existing patterns
  // (module singletons in use-auth/use-theme, set-state-in-effect
  // suppressions in builder files, Date.now in deal-card) trip the
  // rule without being unsafe to ship — the compiler simply skips
  // those components. New code should be compiler-clean.
  reactCompiler.configs.recommended,
  {
    rules: {
      "react-compiler/react-compiler": "warn",
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
