"use client";

/** ⚠ Banco di prova M21-02 — solo l'elenco del telefono, senza niente intorno.
 *  Serve a misurare la riga a 375px senza che un'altra sezione del banco
 *  faccia traboccare la pagina e sposti il margine destro. Si cancella con
 *  `app/banco/` (M21-13). */

import { ElencoMobile } from "../pezzi";
import { RIGHE } from "../dati";

export default function BancoTelefono() {
  return (
    <main className="w-full">
      <ElencoMobile righe={RIGHE} />
    </main>
  );
}
