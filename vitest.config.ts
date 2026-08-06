import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // `next-auth` importa `next/server`, che si risolve solo con la mappa di
    // export di Next: lasciarlo esterno lo farebbe caricare da Node in ESM
    // puro, che quella mappa non la legge.
    server: { deps: { inline: ["next-auth", "@auth/core"] } },
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts", "lib/**/*.test.ts"],
  },
});
