import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const RAW_BUILDERS = [
  "query",
  "mutation",
  "action",
  "internalQuery",
  "internalMutation",
  "internalAction",
  "httpAction",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Backend functions must be built from the permission wrappers in
    // convex/lib/functions.ts, never from Convex's raw builders.
    files: ["convex/**/*.ts"],
    ignores: ["convex/lib/functions.ts", "convex/_generated/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "./_generated/server",
              importNames: RAW_BUILDERS,
              message: "Use the permission wrappers from ./lib/functions instead.",
              allowTypeImports: true,
            },
            {
              name: "../_generated/server",
              importNames: RAW_BUILDERS,
              message: "Use the permission wrappers from ./lib/functions instead.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "convex/_generated/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
