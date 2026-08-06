import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/**
 * Il database si tocca solo da dove è lecito toccarlo.
 *
 * Le regole 3 e 4 di CLAUDE.md ("mai serializzare lo stato fuori da
 * `serializeSnapshot`", "mai mutare un'asta fuori da `withAuctionLock`") sono
 * facili da rispettare finché nessuno prende la scorciatoia di fare una query
 * dentro un componente. Questa regola rende quella scorciatoia un errore di
 * lint invece di una code review dimenticata.
 *
 * L'elenco delle eccezioni è volutamente esplicito: aggiungerne una è un gesto
 * visibile nel diff, non una deriva silenziosa.
 */
const DB_ACCESS_ALLOWED = [
  "lib/db/**", //         il modulo stesso
  "lib/engine/**", //     il motore dell'asta: unico posto che muta lo stato
  "lib/auth.ts", //       login e tabella users (PLAN §15 lo prevede così)
  "scripts/**", //        seed e strumenti da riga di comando
  "drizzle.config.ts", // configurazione di drizzle-kit
  "tests/**", //          i test possono mockare o interrogare il db
];

const noDbImportRules = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: ["@/lib/db", "@/lib/db/*", "**/lib/db", "**/lib/db/*"],
          message:
            "Il database si importa solo da lib/engine/** (più le eccezioni in eslint.config.mjs). " +
            "Dalle pagine e dai componenti si passa da una Server Action o da una funzione del motore.",
        },
      ],
    },
  ],
};

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    rules: noDbImportRules,
  },
  {
    files: DB_ACCESS_ALLOWED,
    rules: { "no-restricted-imports": "off" },
  },
];

export default eslintConfig;
