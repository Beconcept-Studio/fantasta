import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env", quiet: true });

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // `strict: false`: push applica lo schema senza chiedere conferma statement
  // per statement, così `pnpm db:push` è usabile anche da script. `verbose`
  // lascia comunque l'SQL a video prima di eseguirlo.
  strict: false,
  verbose: true,
});
