import type {
  Snapshot,
  SnapshotLot,
  SnapshotMember,
  SnapshotRosterEntry,
} from "@/lib/realtime/types";

/**
 * Lo snapshot di prova, in una forma modificabile pezzo per pezzo.
 *
 * Serve a tutti i test delle funzioni pure che leggono lo snapshot — il portale
 * del partecipante (Fase 5) e il portale manager con la vista TV (Fase 6). Sta
 * qui perché i chiamanti sono due: finché era uno solo viveva dentro
 * `portal.test.ts`, che è dove era giusto stesse (regola 8).
 *
 * Il default è il caso più frequente: asta LIVE a tre partecipanti, lotto
 * aperto, io idoneo e senza ancora una busta consegnata.
 */

export const T = Date.parse("2026-08-07T20:00:00.000Z");

/** Un istante ISO, in millisecondi relativi a `T`. */
export const iso = (offsetMs: number) => new Date(T + offsetMs).toISOString();

export const ME = "member-me";
export const OTHER = "member-other";
export const THIRD = "member-third";

export function member(
  id: string,
  seatIndex: number,
  patch: Partial<SnapshotMember> = {},
): SnapshotMember {
  return {
    id,
    teamName: `Squadra ${seatIndex + 1}`,
    displayName: null,
    seatIndex,
    credits: 500,
    maxBid: 476,
    slotsFilled: { P: 0, D: 0, C: 0, A: 0 },
    presence: "LIVE",
    roster: [],
    ...patch,
  };
}

/**
 * Una riga di rosa, col default che serve quasi sempre: **un'assegnazione nata da
 * un lotto**, non una correzione della regia.
 *
 * ⚠ **`lotSeq` è obbligatorio di proposito** (M22 §7.2). Il default nel tipo
 * sarebbe stato `null`, cioè «assegnazione manuale», e una rosa di prova fatta
 * tutta di assegnazioni manuali è invisibile al termometro di Stats+: i test
 * passerebbero mostrando zero lotti informativi senza che nessuno capisca
 * perché. Qui il numero si scrive, e chi vuole il caso manuale scrive `null`.
 */
export function rosterEntry(
  patch: Partial<SnapshotRosterEntry> & Pick<SnapshotRosterEntry, "lotSeq">,
): SnapshotRosterEntry {
  return {
    assignmentId: `a-${patch.playerId ?? patch.lotSeq}`,
    playerId: "player-1",
    name: "Lautaro",
    role: "A",
    team: "Inter",
    price: 100,
    ...patch,
  };
}

export function lot(patch: Partial<SnapshotLot> = {}): SnapshotLot {
  return {
    id: "lot-1",
    seq: 1,
    player: {
      id: "player-1",
      // L'id di Fantacalcio.it: è quello vero di Lautaro nel listone 2025/26,
      // così un componente che ci costruisce sopra un indirizzo lo costruisce
      // su un numero plausibile (M7).
      extId: 2764,
      name: "Lautaro",
      role: "A",
      team: "Inter",
      fvm: 300,
    },
    calledByMemberId: OTHER,
    autoCalled: false,
    roundNo: 1,
    minAmount: 1,
    endsAt: iso(30_000),
    closedAt: null,
    eligibleMemberIds: [ME, OTHER, THIRD],
    tie: null,
    reveal: null,
    ...patch,
  };
}

export function snapshot(patch: Partial<Snapshot> = {}): Snapshot {
  return {
    serverNow: iso(0),
    stateVersion: 12,
    viewerMemberId: ME,
    auction: {
      id: "auction-1",
      name: "Asta di prova",
      status: "LIVE",
      phase: "LOT_OPEN",
      phaseDeadline: iso(30_000),
      pausedAt: null,
      currentRole: "A",
      currentSeatIndex: 1,
      currentMemberId: OTHER,
      roleOrder: ["P", "D", "C", "A"],
      seats: 8,
      slots: { P: 3, D: 8, C: 8, A: 6 },
      timers: {
        bidSeconds: 30,
        pickSeconds: 60,
        tiePrepSeconds: 5,
        revealSeconds: 10,
        // Il cancello dei risultati come lo propone `DEFAULT_CONFIG` (M14): qui
        // il default è quello di un'asta **nuova**, non quello della colonna.
        resultGateSeconds: 10,
      },
      ...patch.auction,
    },
    members: [member(ME, 0), member(OTHER, 1), member(THIRD, 2)],
    currentLot: lot(),
    myBid: null,
    ...patch,
  };
}
