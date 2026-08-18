"use client";

import Link from "next/link";
import { Toast } from "radix-ui";
import { useCallback, useMemo, useState } from "react";

import { type AdminUserView, UserRow } from "@/components/admin/user-row";
import { UserPanel } from "@/components/admin/user-panel";
import { Input } from "@/components/ui/input";
import {
  type SaveToast,
  type UserSaveState,
  filterUsers,
  saveToast,
  userSearchText,
} from "@/lib/admin-users";
import { cn } from "@/lib/utils";

/**
 * La lista degli utenti: **una tabella che si legge** (M13 §2), con la ricerca in
 * testa e le modifiche in un pannello che si apre da «Vedi».
 *
 * ⚠ **La ricerca filtra sul client, sulle righe già in pagina** (§4), e la
 * differenza col filtro dei bot è di sostanza: quello è una `searchParam` perché
 * cambia **quali righe il server manda**, questa no — la pagina carica già tutti
 * gli utenti, quindi cercare vuol dire nascondere righe che sono già arrivate. Ne
 * viene la sola cosa accettabile per un campo di ricerca: risponde mentre si
 * digita, senza nessun round trip.
 *
 * ⚠ **Niente paginazione, e non per pigrizia** (§4). M6 aveva escluso ricerca e
 * paginazione nella stessa riga, ma non sono la stessa decisione: un filtro su
 * righe già caricate non ha nessuna «pagina 2» in cui una riga possa nascondersi,
 * mentre la paginazione cambia il contratto della pagina — e nel momento in cui
 * esiste, **questa ricerca diventa una bugia**, perché cercherebbe solo dentro la
 * pagina corrente. Il numero che lo tiene in piedi è stato misurato all'apertura
 * della macro: **20 utenti veri in produzione, 32 contando i bot**. Quel giorno
 * arriveranno insieme, ricerca lato server compresa.
 *
 * ⚠ **Il conteggio in cima segue il filtro**, ed è la prima cosa che mentirebbe:
 * «20 righe» sopra una tabella che ne mostra tre è peggio di nessun conteggio.
 *
 * ⚠ **Il toast dell'esito vive qui e non nel pannello**, e la ragione è la stessa per
 * cui esiste: a pieno successo il pannello **si chiude**, quindi un messaggio dentro
 * di lui se ne andrebbe insieme a lui — e un salvataggio riuscito diventerebbe
 * indistinguibile da un click andato perso. Questo componente resta montato, quindi
 * il messaggio sopravvive alla chiusura.
 */
export function UsersTable({
  rows,
  includeBots,
}: {
  rows: AdminUserView[];
  includeBots: boolean;
}) {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  // Il `seq` non è un vezzo: serve a rimontare il toast quando l'esito è **lo
  // stesso** di prima (due volte lo stesso errore), che altrimenti resterebbe fermo
  // com'è e sembrerebbe che il secondo Salva non abbia fatto niente.
  const [notice, setNotice] = useState<{ seq: number; toast: SaveToast } | null>(
    null,
  );

  // Stabile, e conta: l'effetto del pannello dipende da questa funzione, e una
  // funzione nuova a ogni render della tabella gli farebbe rimandare l'esito a ogni
  // rirenderizzata — cioè un toast doppio a ogni salvataggio.
  const handleResult = useCallback((state: UserSaveState) => {
    const toast = saveToast(state);
    if (toast !== null) {
      setNotice((prev) => ({ seq: (prev?.seq ?? 0) + 1, toast }));
    }
    // ⚠ Chiude **solo** a pieno successo: su un salvataggio riuscito a metà il
    // pannello resta aperto col suo esito per campo (§5).
    if (state.done === true) setOpenId(null);
  }, []);

  // I testi cercabili si calcolano **una volta**, non a ogni tasto: è la stessa
  // ragione del Centro dati (M10), dove sono cinquecento righe invece di venti.
  const searchable = useMemo(() => rows.map(userSearchText), [rows]);
  const shown = useMemo(
    () => filterUsers(rows, query, searchable),
    [rows, query, searchable],
  );

  const searching = query.trim() !== "";
  const open = rows.find((row) => row.id === openId) ?? null;

  return (
    <Toast.Provider swipeDirection="right">
      <section className="space-y-4">
        <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span>
            {searching
              ? `${shown.length} di ${rows.length} righe`
              : `${rows.length} ${rows.length === 1 ? "riga" : "righe"}`}
          </span>
          <Link
            href={includeBots ? "/admin/users" : "/admin/users?bots=1"}
            className="underline underline-offset-4"
          >
            {includeBots ? "nascondi i bot" : "mostra anche i bot"}
          </Link>
        </div>

        {/*
          ⚠ **`min-w-240` non c'è più, e il contenitore che scorre sì.** Quella
          larghezza minima esisteva per far stare quattro form in altrettante celle:
          con tre celle che contengono la parola «Sì» non ha più niente da tenere
          aperto, e su un portatile la tabella sta comoda. Il contenitore resta perché
          **la colonna dell'email è lunga e imprevedibile** — è l'unica cosa che può
          ancora costringere allo scorrimento, e su uno schermo stretto è meglio uno
          scorrimento che un indirizzo spezzato in sei righe.
        */}
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-left">
            <thead>
              {/* La ricerca sta nell'intestazione della tabella, come chiede la
                  richiesta: è il posto in cui si guarda quando la lista è la cosa
                  che si sta leggendo. */}
              <tr className="border-b">
                <th colSpan={6} className="px-3 py-2 font-normal">
                  <Input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Cerca per nome o email…"
                    aria-label="Cerca un utente per nome o email"
                    className="max-w-sm"
                  />
                </th>
              </tr>
              <tr className="bg-muted/40 text-muted-foreground border-b text-xs uppercase">
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium">Email verificata</th>
                <th className="px-3 py-2 font-medium">Admin</th>
                {/* M8 — chi vede titolarità, rigoristi e piazzati in `/play`. */}
                <th className="px-3 py-2 font-medium">Pro</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {/* ⚠ Zero risultati si dice **a parole**: una tabella con la sola
                  intestazione sembra un guasto. E se i bot sono nascosti lo si
                  ricorda qui, perché è il posto in cui uno cerca «Bot 3» e non lo
                  trova. */}
              {shown.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="text-muted-foreground px-3 py-6 text-sm"
                  >
                    Nessun utente con «{query.trim()}» nel nome o
                    nell&apos;indirizzo.
                    {!includeBots && " I bot sono nascosti: prova a mostrarli."}
                  </td>
                </tr>
              ) : (
                shown.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    onView={() => setOpenId(user.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Il pannello nasce alla pressione di «Vedi» e muore quando si chiude: così
            lo stato del form non sopravvive a una riga diversa, e riaprirlo non
            mostra il messaggio del salvataggio precedente. */}
        {open !== null && (
          <UserPanel
            key={open.id}
            user={open}
            onClose={() => setOpenId(null)}
            onResult={handleResult}
          />
        )}

        {/*
          ⚠ **`Toast` di `radix-ui`, non `sonner`**, ed è la stessa decisione dello
          `Switch` presa qualche ora prima in questa macro: la pagina «Toast» di shadcn
          oggi è un involucro attorno a `sonner`, cioè una dipendenza nuova per un
          avviso, mentre la libreria di primitive che il progetto usa in ogni componente
          ne ha già uno. Il comportamento chiesto — un avviso che compare, si legge e se
          ne va — è lo stesso.

          ⚠ **Una cosa da sapere sul caso d'errore**: lì il pannello resta aperto, e un
          `Dialog` modale di Radix rende inerte ciò che gli sta fuori — quindi la ✕ di
          questo toast non risponde finché il modale è aperto. Non è un problema da
          risolvere spostando il toast: il messaggio **autorevole** dell'errore è quello
          per campo dentro il pannello, che è anche dove stanno gli occhi; questo è la
          copia che serve nell'altro caso, quello in cui il pannello non c'è più. Il
          toast si chiude da sé, e con più tempo quando c'è qualcosa da leggere.
        */}
        {notice !== null && (
          <Toast.Root
            key={notice.seq}
            duration={notice.toast.kind === "ok" ? 4000 : 10000}
            onOpenChange={(next) => {
              if (!next) setNotice(null);
            }}
            className={cn(
              "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-bottom-2 data-[swipe=end]:animate-out flex items-start gap-3 rounded-lg border p-3 shadow-lg outline-none",
              notice.toast.kind === "ok" && "border-emerald-600/40",
              notice.toast.kind === "partial" && "border-amber-500/50",
              notice.toast.kind === "error" && "border-destructive/50",
            )}
          >
            {/* Il segno non è l'informazione — il titolo dice già cosa è successo — ma
                rende la differenza visibile senza leggere e senza distinguere colori. */}
            <span aria-hidden className="text-base leading-5">
              {notice.toast.kind === "ok"
                ? "✓"
                : notice.toast.kind === "partial"
                  ? "⚠"
                  : "✕"}
            </span>
            <div className="min-w-0 flex-1">
              <Toast.Title
                className={cn(
                  "text-sm font-semibold",
                  notice.toast.kind === "ok" && "text-emerald-800",
                  notice.toast.kind === "partial" && "text-amber-800",
                  notice.toast.kind === "error" && "text-destructive",
                )}
              >
                {notice.toast.title}
              </Toast.Title>
              {notice.toast.description !== null && (
                <Toast.Description className="text-muted-foreground mt-1 text-sm">
                  {notice.toast.description}
                </Toast.Description>
              )}
            </div>
            <Toast.Close
              aria-label="Chiudi l'avviso"
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-md px-1 text-sm outline-none focus-visible:ring-3"
            >
              ✕
            </Toast.Close>
          </Toast.Root>
        )}
        <Toast.Viewport className="fixed right-0 bottom-0 z-[100] flex w-full max-w-sm flex-col gap-2 p-4 outline-none" />
      </section>
    </Toast.Provider>
  );
}
