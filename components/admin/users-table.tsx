"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { type AdminUserView, UserRow } from "@/components/admin/user-row";
import { UserPanel } from "@/components/admin/user-panel";
import { Input } from "@/components/ui/input";
import { filterUsers, userSearchText } from "@/lib/admin-users";

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
        />
      )}
    </section>
  );
}
