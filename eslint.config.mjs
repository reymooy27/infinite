import js from "@eslint/js";
import globals from "globals";

const config = [
  { ignores: ["dist/**", ".server-build/**", "node_modules/**"] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
];

export default config;
