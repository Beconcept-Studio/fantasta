"use client";

/**
 * ⚠ **Banco di prova di M21-02, non codice di produzione.**
 *
 * Serve a *guardare* la tab Listone prima di scriverla, con i componenti veri
 * dell'applicazione, il Tailwind vero e i dati veri di `fixtures/` — è la stessa
 * strada che M20 ha usato per misurare l'altezza del marchio invece di stimarla.
 *
 * ⚠ **Si cancella insieme alla cartella `app/banco/` prima del gate (M21-13).**
 * Finché c'è, `next build` la compila e finirebbe in produzione: è una rotta
 * pubblica senza `requireUser()`, e non deve sopravvivere alla macro.
 */

import { RIGHE } from "./dati";
import {
  BarraTab,
  Controlli,
  ElencoMobile,
  IconaObiettivo,
  Intestazione,
  ModaleImport,
  RigaTabella,
  Sezione,
  Tabella,
  Telefono,
  Thead,
} from "./pezzi";

export default function BancoPage() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-10 p-4 pb-24">
      <Intestazione />

      <Sezione titolo="0 — La proposta, com'è davvero: si restringe la finestra e cambia da sé">
        <div className="bg-card overflow-hidden rounded-xl border shadow-sm">
          <div className="hidden sm:block">
            <Tabella />
          </div>
          <div className="sm:hidden">
            <ElencoMobile righe={RIGHE} />
          </div>
        </div>
      </Sezione>

      <Sezione titolo="1 — La barra delle tab, senza scadenza in corso">
        <BarraTab attiva="listone" scadenza={null} />
      </Sezione>

      <Sezione titolo="2 — La stessa barra mentre tocca a me (§8)">
        <BarraTab
          attiva="listone"
          scadenza={{ scena: "Tocca a te", tempo: "0:24", azione: "Scegli" }}
        />
        <p className="text-muted-foreground mt-2 text-sm">
          È il buco che §8 esiste per chiudere: chi chiude il pannello mentre
          guarda il listone deve vedere qui il tempo che resta e la strada per
          rientrare.
        </p>
      </Sezione>

      <Sezione titolo="3 — La tab spenta per chi non è Pro (§7)">
        <BarraTab attiva="asta" scadenza={null} spenta />
        <p className="text-muted-foreground mt-2 text-sm">
          Il tooltip qui è finto: sul telefono l&apos;hover non esiste, e la
          strada alternativa è la riga di testo qui sotto.
        </p>
        <p className="text-muted-foreground border-muted-foreground/30 mt-2 border-l-2 pl-3 text-xs">
          Il listone dei giocatori è una funzione per gli utenti Pro.
        </p>
      </Sezione>

      <Sezione titolo="4 — I controlli sopra la tabella">
        <Controlli />
      </Sezione>

      <Sezione titolo="5 — La tabella (da sm in su)">
        <div className="bg-card overflow-hidden rounded-xl border shadow-sm">
          <Tabella />
        </div>
      </Sezione>

      <Sezione titolo="6 — La riga sul telefono, variante A: due righe più le note">
        <Telefono>
          <ElencoMobile righe={RIGHE.slice(0, 8)} />
        </Telefono>
      </Sezione>

      <Sezione titolo="7 — La riga sul telefono, variante B: la tabella che scorre">
        <Telefono>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] border-separate border-spacing-0 text-sm">
              <Thead />
              <tbody>
                {RIGHE.slice(0, 5).map((r) => (
                  <RigaTabella key={r.name} r={r} />
                ))}
              </tbody>
            </table>
          </div>
        </Telefono>
        <p className="text-muted-foreground mt-2 text-sm">
          È la strada del Centro dati. Onesta, ma chiede di scorrere in
          orizzontale la cosa principale di una tab, su un telefono, durante
          un&apos;asta.
        </p>
      </Sezione>

      <Sezione titolo="8 — L'icona dell'obiettivo: sempre, o solo quando c'è">
        <div className="flex flex-wrap gap-8">
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs">
              a — sempre presente, grigia o verde
            </p>
            <div className="bg-card w-64 divide-y rounded-lg border">
              {RIGHE.slice(0, 4).map((r) => (
                <div key={r.name} className="flex items-center gap-2 px-3 py-2">
                  <IconaObiettivo obiettivo={r.obiettivo} sempre />
                  <span className="text-sm font-medium">{r.name}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs">
              b — solo sugli obiettivi
            </p>
            <div className="bg-card w-64 divide-y rounded-lg border">
              {RIGHE.slice(0, 4).map((r) => (
                <div key={r.name} className="flex items-center gap-2 px-3 py-2">
                  <IconaObiettivo obiettivo={r.obiettivo} />
                  <span className="text-sm font-medium">{r.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Sezione>

      <Sezione titolo="9 — Il modale «Importa obiettivi» (§6)">
        <ModaleImport />
      </Sezione>
    </main>
  );
}

