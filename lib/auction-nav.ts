/**
 * Il vocabolario della navigazione dentro un'asta: sezioni, etichette, titoli.
 *
 * Sta in un file suo, senza nessuna dipendenza, per le stesse due ragioni di
 * `lib/domain.ts` — che è il suo gemello. Non importa `lib/db` e non importa
 * niente, quindi lo può leggere anche il client component che evidenzia la voce
 * attiva, senza portarsi l'ORM nel bundle del telefono.
 *
 * Ma la ragione principale è un'altra, ed è un bug vero: prima di M2 ogni pagina
 * si scriveva i propri link a mano, e nell'intestazione della configurazione la
 * voce «Pannello di configurazione» puntava alla lobby. Un'etichetta e una
 * destinazione tenute insieme da nient'altro che l'attenzione divergono, prima o
 * poi. Qui **etichetta, titolo e segmento di URL escono dalla stessa riga**: il
 * titolo che leggi in cima alla pagina e la voce da cui ci sei arrivato non
 * possono raccontare due cose diverse, perché sono lo stesso oggetto.
 *
 * ⚠ Le sezioni dipendono dal **ruolo** di chi guarda e mai dallo **stato**
 * dell'asta. Non è solo prevedibilità: il ruolo non cambia mentre guardi la
 * pagina, lo stato sì. Una sotto-navbar che dipendesse da `status` sarebbe
 * renderizzata dal server a inizio pagina e mostrerebbe voci sbagliate dopo la
 * prima transizione — a meno di alimentarla dallo snapshot, cioè di trasformare
 * la navigazione in stato di gioco (regola 7).
 */

export const AUCTION_SECTION_KEYS = [
  "setup",
  "lobby",
  "manage",
  "play",
] as const;
export type AuctionSectionKey = (typeof AUCTION_SECTION_KEYS)[number];

export type AuctionSection = {
  key: AuctionSectionKey;
  /** Il segmento dopo `/auctions/[id]/`. */
  segment: string;
  /** La voce nella sotto-navbar. */
  label: string;
  /** Il titolo in cima alla pagina. */
  title: string;
};

/**
 * Chi sta guardando, ridotto a ciò che decide la navigazione.
 *
 * Sono i due booleani che `getAuctionOverview` restituisce già: possedere
 * l'asta e giocarci sono indipendenti — l'owner che non ha joinato (⚠ P11)
 * conduce e non ha un portale.
 */
export type NavViewer = {
  isOwner: boolean;
  isMember: boolean;
};

/**
 * L'ordine è quello del flusso di una serata, non alfabetico: si configura, si
 * aspetta in lobby, si conduce, si gioca.
 */
const SECTIONS: (AuctionSection & { visibleTo: (v: NavViewer) => boolean })[] = [
  {
    key: "setup",
    segment: "setup",
    label: "Configurazione",
    title: "Configurazione dell'asta",
    visibleTo: (v) => v.isOwner,
  },
  {
    key: "lobby",
    segment: "lobby",
    label: "Lobby",
    title: "Lobby",
    visibleTo: (v) => v.isOwner || v.isMember,
  },
  {
    key: "manage",
    segment: "manage",
    label: "Regia",
    title: "Regia dell'asta",
    visibleTo: (v) => v.isOwner,
  },
  {
    key: "play",
    segment: "play",
    label: "Portale",
    title: "Il tuo portale",
    visibleTo: (v) => v.isMember,
  },
];

/** Le sezioni che questo viewer può raggiungere, nell'ordine della sotto-navbar. */
export function auctionSections(viewer: NavViewer): AuctionSection[] {
  return SECTIONS.filter((section) => section.visibleTo(viewer)).map(
    ({ key, segment, label, title }) => ({ key, segment, label, title }),
  );
}

export function sectionHref(auctionId: string, section: AuctionSection): string {
  return `/auctions/${auctionId}/${section.segment}`;
}

/**
 * La sezione a cui appartiene un pathname, o `null` se siamo fuori da un'asta.
 *
 * Ricavarla dall'URL invece di farsela dichiarare da ogni pagina è ciò che
 * rende impossibile a una pagina mentire su dove si trova: il titolo lo decide
 * la rotta, e la rotta è quella che c'è nella barra degli indirizzi.
 */
export function activeSection(pathname: string): AuctionSection | null {
  const parts = pathname.split("/").filter((part) => part !== "");
  // ["auctions", "<id>", "<segmento>"] — meno di tre pezzi vuol dire che siamo
  // sulla lista delle aste o su una rotta che con l'asta non c'entra.
  if (parts.length < 3 || parts[0] !== "auctions") return null;
  return auctionSections({ isOwner: true, isMember: true }).find(
    (section) => section.segment === parts[2],
  ) ?? null;
}
