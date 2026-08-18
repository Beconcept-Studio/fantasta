import { and, eq } from "drizzle-orm";

import { assignments, ledger } from "@/lib/db/schema";

import { describePosition, writeEvent } from "./actions";
import { type Result, fail, ok } from "./errors";
import { isUuid } from "./ids";
import { type LoadedAuction, withAuctionLock } from "./mutate";
import { canAdjustBudget, canManualAssign, credits } from "./rules";
import type { Millis } from "./types";

/**
 * Il ripescaggio degli errori (PLAN §9, sezione «Override manager»).
 *
 * Sono le uniche azioni dell'applicazione che **riscrivono un fatto già
 * accaduto**: tutto il resto aggiunge storia — un lotto, una busta, un turno —
 * mentre queste tre tornano su una rosa e la correggono. Per questo hanno
 * regole loro, e sono tre.
 *
 * ## 1. Niente undo (⚠ P1)
 *
 * Non esiste un «annulla l'ultimo lotto». Un lotto sbagliato si corregge con
 * `voidAssignment` + `manualAssign`: il giocatore esce da una rosa, i crediti
 * risalgono da soli (sono una formula, non una colonna) e l'esito giusto si
 * scrive a mano. **La rotazione dei turni non torna mai indietro** — chi ha
 * chiamato ha chiamato. Il motivo è che il ripristino di turno e ruolo era la
 * parte più fragile della specifica, e in diretta una correzione che sposta
 * anche il turno è una correzione che nessuno sa più raccontare a voce.
 *
 * ⚠ **Da M14 c'è un'eccezione, e vive fuori da questo file**: «Annulla lotto»
 * (`CANCEL_LOT` in `machine.ts`) riporta il turno al chiamante. Non contraddice
 * quanto sopra, lo delimita: quell'annullamento esiste **solo dentro il cancello
 * dei risultati**, cioè nell'unico momento in cui il lotto non ha ancora prodotto
 * niente — nessuna assegnazione, nessun credito speso, nessuna rotazione avanzata.
 * Il ritorno indietro è possibile lì perché lì non c'è niente da riportare
 * indietro. **Dopo il reveal resta questa strada e resta questa regola.**
 *
 * ## 2. Solo senza un lotto in contesa
 *
 * `phase ∈ {LOT_OPEN, LOT_SEALED, LOT_TIE_PREP}` → rifiuto, **anche ad asta in
 * pausa**: la pausa congela la fase, non la azzera. Toccare le rose mentre le buste
 * sono aperte cambierebbe `max_bid` e l'idoneità *sotto* un round già iniziato: chi
 * ha offerto 40 due secondi fa si troverebbe l'offerta fuori tetto senza aver
 * fatto niente. Il momento buono è quello in cui non c'è nessuna busta aperta:
 * WAITING_PICK, il reveal, o l'asta ferma **con nessun lotto sigillato**.
 *
 * ## 3. Mai un DELETE (regola 5)
 *
 * Un'assegnazione annullata resta a database con `voided_at`, e una rettifica
 * di budget è una riga in più nel `ledger`, mai una colonna sovrascritta. Il
 * credito è `budget_initial + Σ ledger.delta − Σ price non annullati`: dopo la
 * sera dell'asta si può ricostruire non solo *quanto* aveva ciascuno, ma
 * **perché**. È la differenza fra un archivio e un saldo.
 *
 * ## Perché non sono transizioni della macchina
 *
 * Non hanno un `now` che le fa scattare, non spostano la fase e non producono
 * uno stato successivo: sono scritture puntuali su `assignments` e `ledger`.
 * Passano comunque da `withAuctionLock` (regola 4), quindi si serializzano con
 * le offerte e con lo sweep, bumpano `state_version` e fanno partire lo
 * snapshot — un void deve arrivare sui telefoni come ci arriva un'offerta. Ma
 * le regole del gioco non le riguardano: le loro sono le invarianti, e stanno
 * in `rules.ts` come funzioni pure.
 */

// ─── Le guardie comuni ───────────────────────────────────────────────────────

function requireOwner(loaded: LoadedAuction, userId: string): Result<never> | null {
  if (loaded.auction.ownerUserId !== userId) {
    return fail("FORBIDDEN", "Solo chi ha creato l'asta può correggerla.");
  }
  return null;
}

/**
 * La regola 2: niente override con un lotto in contesa.
 *
 * Guarda `phase`, non `status`, ed è deliberato — in PAUSED la fase resta
 * quella di prima, quindi mettere in pausa **non** apre la porta alle
 * correzioni se le buste sono aperte. Il rimedio è aspettare il reveal: sono
 * dieci secondi.
 *
 * ⚠ **`LOT_SEALED` è in elenco, e non come precauzione in più** (M14 §6). Un lotto
 * sigillato **è** un lotto in contesa — è il momento più in contesa che ci sia,
 * perché l'esito è già deciso dalle buste e nessuno lo conosce ancora, nemmeno il
 * server. Assegnare a mano un giocatore lì vorrebbe dire correggere una rosa mentre
 * una busta chiusa sta per cambiarla.
 *
 * ⚠ **E questa riga è il presupposto di `cancelLot`**, non un extra: l'annullamento
 * riporta il turno al chiamante, e regge solo perché il ruolo del chiamante non può
 * essersi riempito nel frattempo. L'unica cosa che riempie un ruolo fuori da un lotto
 * è `manualAssign`. Togliere `LOT_SEALED` da qui romperebbe una funzione in
 * `machine.ts`, da un altro file e senza che niente lo segnali.
 */
function requireNoContestedLot(loaded: LoadedAuction): Result<never> | null {
  const { phase } = loaded.state;
  if (
    phase === "LOT_OPEN" ||
    phase === "LOT_SEALED" ||
    phase === "LOT_TIE_PREP"
  ) {
    return fail(
      "WRONG_PHASE",
      "C'è un lotto in contesa: le correzioni si fanno quando nessuna busta è aperta. Aspetta l'assegnazione, poi correggi.",
    );
  }
  return null;
}

/** Il nome del membro, per i messaggi e per la riga di `events`. */
function memberLabel(loaded: LoadedAuction, memberId: string): string {
  const info = loaded.view.members.get(memberId);
  return info?.teamName ?? memberId;
}

// ─── manualAssign (F7-01) ────────────────────────────────────────────────────

export type ManualAssignInput = {
  memberId: string;
  playerId: string;
  price: number;
  /**
   * ⚠ Deroga **solo** a I4 (slot di ruolo in eccesso), mai a I2 e mai a I3.
   * Esiste per la sera in cui si è sbagliato a contare e una rosa con un
   * difensore in più è preferibile a un'asta ferma.
   */
  force?: boolean;
};

/**
 * Assegna un giocatore a una rosa senza passare dall'asta (`source = MANUAL`,
 * `lot_id = NULL`: non c'è nessun lotto che lo abbia deciso).
 *
 * Le invarianti le decide `canManualAssign`, che è pura e ha i suoi test;
 * l'indice unico parziale `one_owner_per_player` è la seconda linea, quella che
 * regge anche sotto concorrenza — ma con il lock preso non ci si arriva mai,
 * e se ci si arrivasse sarebbe un bug, non un rifiuto.
 */
export async function manualAssign(
  actorUserId: string,
  auctionId: string,
  input: ManualAssignInput,
  now: Millis = Date.now(),
): Promise<Result<{ assignmentId: string }>> {
  const force = input.force ?? false;

  return withAuctionLock(auctionId, async (tx, loaded) => {
    const denied =
      requireOwner(loaded, actorUserId) ?? requireNoContestedLot(loaded);
    if (denied) return { result: denied, mutated: false };

    if (!isUuid(input.memberId) || !isUuid(input.playerId)) {
      return {
        result: fail<{ assignmentId: string }>(
          "NOT_FOUND",
          "Membro o giocatore inesistenti.",
        ),
        mutated: false,
      };
    }

    const allowed = canManualAssign(
      loaded.state,
      input.memberId,
      input.playerId,
      input.price,
      force,
    );
    if (!allowed.ok) {
      return { result: allowed, mutated: false };
    }

    const [row] = await tx
      .insert(assignments)
      .values({
        auctionId: loaded.auction.id,
        memberId: input.memberId,
        playerId: input.playerId,
        price: input.price,
        lotId: null,
        source: "MANUAL",
        createdAt: new Date(now),
      })
      .returning({ id: assignments.id });

    await writeEvent(
      tx,
      loaded.auction.id,
      "MANUAL_ASSIGN",
      {
        at: describePosition(loaded.state),
        actor: actorUserId,
        assignmentId: row.id,
        memberId: input.memberId,
        team: memberLabel(loaded, input.memberId),
        playerId: input.playerId,
        player: loaded.view.players.get(input.playerId)?.name ?? null,
        price: input.price,
        force,
      },
      now,
    );

    return { result: ok({ assignmentId: row.id }), mutated: true };
  });
}

// ─── voidAssignment (F7-02) ──────────────────────────────────────────────────

/**
 * Cancella un giocatore da una rosa: `voided_at`, **mai un DELETE** (regola 5).
 *
 * Non c'è nessuna invariante da controllare, ed è una proprietà del disegno,
 * non una dimenticanza. Annullare restituisce `price` crediti e riapre uno
 * slot: I3 chiede `crediti ≥ slot residui`, e con `price ≥ 1` — il pavimento
 * che `canManualAssign` impone e che il regolamento impone alle offerte — il
 * membro guadagna almeno tanti crediti quanti slot riapre. I2 e I4 possono
 * solo migliorare.
 *
 * Ripeterla è un no-op: il doppio click su un pulsante che intanto è sparito
 * dalla schermata non deve produrre un errore da leggere in diretta.
 */
export async function voidAssignment(
  actorUserId: string,
  auctionId: string,
  assignmentId: string,
  now: Millis = Date.now(),
): Promise<Result<{ voided: boolean }>> {
  return withAuctionLock(auctionId, async (tx, loaded) => {
    const denied =
      requireOwner(loaded, actorUserId) ?? requireNoContestedLot(loaded);
    if (denied) return { result: denied, mutated: false };

    const notFound = fail<{ voided: boolean }>(
      "ASSIGNMENT_NOT_FOUND",
      "Questa assegnazione non esiste in quest'asta.",
    );
    if (!isUuid(assignmentId)) return { result: notFound, mutated: false };

    const [row] = await tx
      .select()
      .from(assignments)
      .where(
        and(
          eq(assignments.id, assignmentId),
          eq(assignments.auctionId, loaded.auction.id),
        ),
      );
    if (!row) return { result: notFound, mutated: false };
    if (row.voidedAt !== null) {
      // Già annullata: niente da scrivere, nessun bump, nessun broadcast (P14).
      return { result: ok({ voided: false }), mutated: false };
    }

    await tx
      .update(assignments)
      .set({ voidedAt: new Date(now) })
      .where(eq(assignments.id, assignmentId));

    await writeEvent(
      tx,
      loaded.auction.id,
      "VOID_ASSIGNMENT",
      {
        at: describePosition(loaded.state),
        actor: actorUserId,
        assignmentId,
        memberId: row.memberId,
        team: memberLabel(loaded, row.memberId),
        playerId: row.playerId,
        player: loaded.view.players.get(row.playerId)?.name ?? null,
        price: row.price,
        source: row.source,
        lotId: row.lotId,
      },
      now,
    );

    return { result: ok({ voided: true }), mutated: true };
  });
}

// ─── adjustBudget (F7-03) ────────────────────────────────────────────────────

/**
 * Una rettifica di crediti: una riga in `ledger` con delta, motivo e autore.
 *
 * Il motivo è obbligatorio perché il `ledger` è l'unico posto in cui un numero
 * dell'asta cambia senza che sia successo niente sul campo: fra sei mesi «−20»
 * senza una riga di spiegazione è indistinguibile da un errore di battitura.
 *
 * **I3 non è derogabile** (PLAN §9, §12.20, §12.39): una rettifica che lascia
 * un membro con meno crediti degli slot ancora da riempire lo mette in una
 * posizione da cui non può completare la rosa, e l'asta si blocca sul suo turno.
 */
export async function adjustBudget(
  actorUserId: string,
  auctionId: string,
  memberId: string,
  delta: number,
  reason: string,
  now: Millis = Date.now(),
): Promise<Result<{ ledgerId: string; credits: number }>> {
  type Out = { ledgerId: string; credits: number };

  return withAuctionLock(auctionId, async (tx, loaded) => {
    const denied =
      requireOwner(loaded, actorUserId) ?? requireNoContestedLot(loaded);
    if (denied) return { result: denied, mutated: false };

    if (!isUuid(memberId) || !loaded.state.members.some((m) => m.id === memberId)) {
      return {
        result: fail<Out>("MEMBER_NOT_FOUND", "Membro sconosciuto per questa asta."),
        mutated: false,
      };
    }
    if (!Number.isInteger(delta) || delta === 0) {
      return {
        result: fail<Out>(
          "INVALID_AMOUNT",
          "La rettifica è un numero intero di crediti diverso da zero.",
        ),
        mutated: false,
      };
    }
    const motivo = reason.trim();
    if (motivo === "") {
      return {
        result: fail<Out>(
          "INVALID_REQUEST",
          "Scrivi il motivo della rettifica: è ciò che la rende leggibile fra sei mesi.",
        ),
        mutated: false,
      };
    }

    const allowed = canAdjustBudget(loaded.state, memberId, delta);
    if (!allowed.ok) return { result: allowed, mutated: false };

    const [row] = await tx
      .insert(ledger)
      .values({
        auctionId: loaded.auction.id,
        memberId,
        delta,
        reason: motivo,
        actorUserId,
        createdAt: new Date(now),
      })
      .returning({ id: ledger.id });

    await writeEvent(
      tx,
      loaded.auction.id,
      "ADJUST_BUDGET",
      {
        at: describePosition(loaded.state),
        actor: actorUserId,
        ledgerId: row.id,
        memberId,
        team: memberLabel(loaded, memberId),
        delta,
        reason: motivo,
      },
      now,
    );

    return {
      result: ok({
        ledgerId: row.id,
        // I crediti che il membro ha adesso. `loaded.state` è quello di prima
        // della riga appena scritta, quindi il delta si somma qui: ricaricare
        // l'asta per un numero che si conosce già sarebbe una query in più
        // dentro il lock.
        credits: credits(loaded.state, memberId) + delta,
      }),
      mutated: true,
    };
  });
}
