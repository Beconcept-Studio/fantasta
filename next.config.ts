import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Processo Node persistente su un singolo VPS (PLAN §1): niente serverless.
  // Lo scheduler in-process e lo stream SSE dipendono da questo.
  output: "standalone",

  /**
   * `pg` resta fuori dal bundle e viene richiesto a runtime da Node.
   *
   * Senza questa riga il server **non parte**: webpack segue `pg` fin dentro
   * `pg/lib/native`, non risolve né `fs` né `pg-native` e ogni pagina risponde
   * 500. Il percorso che lo tira dentro è `instrumentation.ts` → scheduler →
   * `lib/db`: la guardia `NEXT_RUNTIME !== 'nodejs'` e l'import dinamico
   * evitano di *eseguire* il driver fuori da Node, ma non impediscono al
   * bundler di analizzarlo.
   */
  serverExternalPackages: ["pg"],
};

export default nextConfig;
