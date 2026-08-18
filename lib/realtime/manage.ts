import type { Role } from "@/lib/domain";

import { fold, takenPlayerIds } from "./portal";
import type { PoolPlayer, Snapshot, SnapshotMember } from "./types";

/**
 * Il portale manager, nella parte che si può provare senza un browser.
 *
 * È la stessa disciplina di `portal.ts` applicata all'altro lato del tavolo: se
 * ogni schermata è funzione dello snapshot (regola 7), allora «si può avviare?»,
 * «chi manca all'appello?» e «quanto ha speso ciascuno?» sono funzioni pure. Il
 * pulsante è la parte facile; quella che decide se abilitarlo è questa.
 *
 * E come sempre (regola 6) **niente di ciò che sta qui autorizza qualcosa**:
 * `startAuction`, `pauseAuction` e `resumeAuction` rifanno da sé la verifica
 * della proprietà dell'asta e del cancello di presence. Qui si decide solo cosa
 * mostrare e cosa spiegare *prima* del round trip; se i due divergono, quello
 * giusto è il server.
 */

// ─── Chi manca all'appello ───────────────────────────────────────────────────

/**
 * I membri che non hanno la pagina davanti, in ordine di posto.
 *
 * `LIVE` significa visto negli ultimi 15 secondi **e** con il tab in primo
 * piano: chi è IDLE non è caduto, ma nemmeno sta guardando: con trenta secondi
 * di countdown la differenza è accademica.
 */
export function absentMembers(snapshot: Snapshot): SnapshotMember[] {
  return snapshot.members.filter((m) => m.presence !== "LIVE");
}

export type PresenceAlert = {
  /** Chi è proprio caduto: non riceve più niente e subirà auto-pick e auto-bid. */
  offline: SnapshotMember[];
  /** Chi ha la pagina aperta ma in secondo piano: va chiamato a voce. */
  idle: SnapshotMember[];
};

/**
 * L'alert del manager ad asta iniziata (F6-04, PLAN §7).
 *
 * **Nessuna pausa automatica**: se qualcuno cade, i timer fanno il loro lavoro
 * — auto-pick del miglior `fvm` e auto-bid a 1 — e sta a chi conduce decidere
 * se fermare tutto. Un'asta che si mette in pausa da sola perché un telefono è
 * andato in standby si bloccherebbe ogni due minuti.
 *
 * `null` prima dell'avvio: in lobby i pallini non sono un guasto, sono il
 * cancello, e l'owner li sta già guardando.
 */
export function presenceAlert(snapshot: Snapshot): PresenceAlert | null {
  const { status } = snapshot.auction;
  if (status !== "LIVE" && status !== "PAUSED") return null;
  const absent = absentMembers(snapshot);
  if (absent.length === 0) return null;
  return {
    offline: absent.filter((m) => m.presence === "OFFLINE"),
    idle: absent.filter((m) => m.presence === "IDLE"),
  };
}

// ─── I comandi ───────────────────────────────────────────────────────────────

export type ManagerControls = {
  canStart: boolean;
  /** Perché non si può avviare, già scritto in italiano; `null` se si può. */
  startBlocked: string | null;
  canPause: boolean;
  canResume: boolean;
  /** «Prosegui asta»: chiudere il reveal senza aspettarne la scadenza. */
  canSkipReveal: boolean;
  /** «Mostra risultati» (M14): aprire le buste senza aspettare il cancello. */
  canShowResults: boolean;
  /** «Annulla lotto» (M14): solo ad asta in pausa, e solo dentro il cancello. */
  canCancelLot: boolean;
};

/**
 * Cosa può fare l'owner adesso, e cosa dirgli quando non può.
 *
 * Il cancello d'avvio è quello di `startAuction` (F4-06) ripetuto sul client:
 * asta `READY` — cioè con tutti i posti occupati, che è una derivazione del
 * setup — e **tutti i membri in presence LIVE**. Non "non OFFLINE": LIVE. Chi
 * ha il telefono in tasca all'avvio scopre l'asta partita dopo aver perso il
 * primo lotto, e non è un errore recuperabile.
 *
 * `canSkipReveal` ripete la guardia di `skipReveal`: asta `LIVE` — non in
 * pausa, che congela la fase — e fase `LOT_REVEAL`. Come sempre, disabilitare
 * non è autorizzare: chi non possiede l'asta viene rifiutato dal server anche
 * se il pulsante gli comparisse davanti (regola 6).
 *
 * Le due leve del cancello dei risultati (M14) ripetono le guardie del motore, e la
 * differenza fra loro è la cosa da leggere: **«Mostra risultati» vuole `LIVE`,
 * «Annulla lotto» vuole `PAUSED`**, e sono la stessa fase. Non è una simmetria
 * imperfetta — è il disegno: il cancello che scorre si può anticipare, il cancello
 * fermo si può disfare. Annullare un lotto mentre il suo countdown corre sarebbe una
 * corsa con il proprio timer.
 *
 * ⚠ **«Metti in pausa» non è un pulsante nuovo, e `canPause` non cambia**: guarda
 * `status`, non la fase, quindi durante il cancello è già vero. M14 non aggiunge una
 * pausa — si assicura che in quel momento sia a portata di pollice e che il testo
 * accanto dica cosa succede *adesso*.
 */
export function managerControls(snapshot: Snapshot): ManagerControls {
  const { status, phase } = snapshot.auction;
  // I comandi ad asta in corso non dipendono dal cancello d'avvio: si
  // calcolano una volta e valgono per tutti i rami qui sotto.
  const running = {
    canPause: status === "LIVE",
    canResume: status === "PAUSED",
    canSkipReveal: status === "LIVE" && phase === "LOT_REVEAL",
    canShowResults: status === "LIVE" && phase === "LOT_SEALED",
    canCancelLot: status === "PAUSED" && phase === "LOT_SEALED",
  };

  if (status === "LIVE" || status === "PAUSED") {
    return { canStart: false, startBlocked: "L'asta è già in corso.", ...running };
  }
  if (status === "COMPLETED") {
    return { canStart: false, startBlocked: "L'asta è finita.", ...running };
  }
  if (status === "DRAFT") {
    return {
      canStart: false,
      startBlocked:
        "Mancano dei partecipanti: l'asta parte quando tutti i posti sono occupati.",
      ...running,
    };
  }

  const absent = absentMembers(snapshot);
  if (absent.length > 0) {
    return {
      canStart: false,
      startBlocked: `L'asta può partire quando sono collegati tutti.`,
      ...running,
    };
  }
  return { canStart: true, startBlocked: null, ...running };
}

// ─── Il recap ────────────────────────────────────────────────────────────────

/**
 * Quanto ha speso un membro: la somma dei prezzi pagati.
 *
 * Il budget iniziale non viaggia nello snapshot, e non serve — `speso +
 * crediti` lo ricostruisce, ed è la stessa identità con cui si controlla a
 * colpo d'occhio che i conti tornino (I3).
 */
export function spentCredits(member: SnapshotMember): number {
  return member.roster.reduce((sum, entry) => sum + entry.price, 0);
}

// ─── Le correzioni (Fase 7) ──────────────────────────────────────────────────

export type OverrideControls = {
  /** `false` con un lotto in contesa: i tre pannelli si disabilitano. */
  allowed: boolean;
  /** Perché non si può, già scritto in italiano; `null` se si può. */
  blocked: string | null;
};

/**
 * Se è il momento di correggere (PLAN §9): **mai con un lotto in contesa**,
 * cioè con `phase ∈ {LOT_OPEN, LOT_SEALED, LOT_TIE_PREP}`, e la pausa non cambia
 * niente perché congela la fase invece di azzerarla.
 *
 * È la copia client del rifiuto che `lib/engine/override.ts` fa comunque
 * (regola 6): serve a spiegare *prima* del round trip, non ad autorizzare. Il
 * messaggio dice quanto bisogna aspettare, perché «non si può adesso» senza un
 * «fra dieci secondi sì» in diretta genera solo un secondo tentativo.
 *
 * ⚠ **`LOT_SEALED` è il caso in cui questa copia conta più che mai** (M14 §6). Il
 * cancello dei risultati è il momento in cui l'owner sta guardando la regia con il
 * dito sopra i pulsanti, e i pannelli delle correzioni sono nella stessa pagina: se
 * qui restassero abilitati, l'unico modo di scoprire il divieto sarebbe premere. E
 * quel divieto non è cortesia — è ciò che rende sicuro «Annulla lotto», che riporta
 * il turno al chiamante contando sul fatto che nessuno gli abbia riempito il ruolo.
 */
export function overrideControls(snapshot: Snapshot): OverrideControls {
  const { phase } = snapshot.auction;
  if (
    phase === "LOT_OPEN" ||
    phase === "LOT_SEALED" ||
    phase === "LOT_TIE_PREP"
  ) {
    return {
      allowed: false,
      blocked:
        "C'è un lotto in contesa: le correzioni si fanno quando nessuna busta è aperta. Aspetta l'assegnazione — sono pochi secondi — poi correggi.",
    };
  }
  return { allowed: true, blocked: null };
}

/**
 * I giocatori che il manager può assegnare a mano: tutto il pool meno chi ha
 * già un proprietario, filtrato per ruolo e per testo cercato.
 *
 * Differisce da `availablePlayers` del portale in una cosa sola, ed è la cosa
 * che conta: **non c'è un ruolo corrente**. Il partecipante può chiamare solo
 * nel ruolo che si sta giocando; il manager corregge una rosa qualunque, in un
 * ruolo qualunque — è proprio per gli errori fuori dal ruolo corrente che
 * questo pannello esiste.
 */
export function assignablePlayers(
  pool: PoolPlayer[],
  snapshot: Snapshot,
  role: Role | null,
  query = "",
): PoolPlayer[] {
  const taken = takenPlayerIds(snapshot);
  const needle = fold(query.trim());
  return pool
    .filter(
      (p) =>
        !taken.has(p.id) &&
        (role === null || p.role === role) &&
        (needle === "" ||
          fold(p.name).includes(needle) ||
          fold(p.team).includes(needle)),
    )
    .sort((a, b) => b.fvm - a.fvm || b.quot - a.quot || a.name.localeCompare(b.name));
}
