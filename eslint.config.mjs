import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"
import prettier from "eslint-config-prettier/flat"

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      // Downgrade to warning - many components legitimately need setState in effects
      "react-hooks/set-state-in-effect": "warn",
      // Enforce camelCase naming convention
      "@typescript-eslint/naming-convention": [
        "warn",
        // Variables, functions, parameters: camelCase
        {
          selector: "variableLike",
          format: ["camelCase", "PascalCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },
        // Functions: camelCase or PascalCase (for React components)
        {
          selector: "function",
          format: ["camelCase", "PascalCase"],
        },
        // Types, interfaces, classes, enums: PascalCase
        {
          selector: "typeLike",
          format: ["PascalCase"],
        },
        // Object properties: allow snake_case (for API responses)
        {
          selector: "objectLiteralProperty",
          format: null,
        },
        // Type properties: camelCase (warn for snake_case)
        {
          selector: "typeProperty",
          // format: ["camelCase"]
          format: null,
        },
      ],
    },
  },
  globalIgnores([
    "node_modules/**",
    ".next/**",
    "dist/**",
    "build/**",
    "public/**",
    "out/**",
    "next-env.d.ts",
    "scripts/**",
  ]),
])

export default eslintConfig
