import type { AuctionStatus } from "@/lib/domain";

/**
 * Il vocabolario della navigazione dentro un'asta: sezioni, etichette, titoli.
 *
 * Sta in un file suo, quasi senza dipendenze, per le stesse due ragioni di
 * `lib/domain.ts` — che è il suo gemello, ed è anche l'unica cosa che importa,
 * per un tipo. Non importa `lib/db` e non importa niente altro, quindi lo può
 * leggere anche il client component che evidenzia la voce attiva, senza
 * portarsi l'ORM nel bundle del telefono.
 *
 * Ma la ragione principale è un'altra, ed è un bug vero: prima di M2 ogni pagina
 * si scriveva i propri link a mano, e nell'intestazione della configurazione la
 * voce «Pannello di configurazione» puntava alla lobby. Un'etichetta e una
 * destinazione tenute insieme da nient'altro che l'attenzione divergono, prima o
 * poi. Qui **etichetta, titolo e segmento di URL escono dalla stessa riga**: il
 * titolo che leggi in cima alla pagina e la voce da cui ci sei arrivato non
 * possono raccontare due cose diverse, perché sono lo stesso oggetto.
 *
 * ⚠ **Fino a M16 le sezioni dipendevano dal ruolo di chi guarda e mai dallo
 * stato dell'asta**, e la regola aveva una ragione tecnica che vale ancora la
 * pena conoscere: il ruolo non cambia mentre guardi la pagina, lo stato sì, e
 * questa navbar è renderizzata dal server: se dipende da `status`, dopo una
 * transizione mostra una voce vecchia finché non si naviga.
 *
 * La regola è stata **ristretta invece che abolita**, e la differenza è tutta
 * qui: lo stato entra in **un caso solo**, la Lobby, e solo per nascondere una
 * voce che porta a un rimbalzo — chi è membro, ad asta `LIVE`, dalla lobby viene
 * spinto al portale da `LobbyLive`. Un link che rimanda indietro è peggio di un
 * link assente. Il costo della staleness è piccolo per costruzione: il layout è
 * dinamico e si rirenderizza a ogni navigazione, e **la spinta al portale è essa
 * stessa una navigazione**, quindi il caso che conta si corregge da sé
 * nell'istante in cui si verifica. Resta stantia solo per chi sta fermo su una
 * pagina mentre l'asta cambia stato.
 *
 * ⚠ E lo stato **non** arriva dallo snapshot: arriva da `getAuctionOverview`,
 * cioè dalla stessa lettura da cui esce il resto del layout. Alimentare la
 * navigazione dallo stream sarebbe trasformarla in stato di gioco (regola 7), e
 * quella riga della regola non si è mossa.
 */

export const AUCTION_SECTION_KEYS = [
  "setup",
  "lobby",
  "manage",
  "play",
  "log",
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
 * Lo stato dell'asta, ridotto a ciò che decide la navigazione.
 *
 * È un oggetto e non un `AuctionStatus` nudo perché il giorno che una seconda
 * voce avesse bisogno di sapere qualcos'altro — la fase, il numero di lotti —
 * la firma non cambia. Oggi ha un campo solo, e un campo solo lo usa.
 */
export type NavAuction = {
  status: AuctionStatus;
};

/**
 * L'ordine è quello del flusso di una serata, non alfabetico: si configura, si
 * aspetta in lobby, si conduce, si gioca.
 */
const SECTIONS: (AuctionSection & {
  visibleTo: (v: NavViewer, a: NavAuction) => boolean;
})[] = [
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
    // ⚠ **L'unica voce che guarda lo stato** (M16), e la condizione è copiata
    // dal `router.push` di `LobbyLive`: chi è membro, ad asta `LIVE`, dalla
    // lobby viene spinto al portale. Mostrargli il link vuol dire offrirgli un
    // viaggio di andata e ritorno.
    //
    // Le due esclusioni dalla condizione sono deliberate. **`PAUSED` no**: in
    // pausa la spinta non c'è — è stata tolta apposta, perché è il momento in
    // cui si va a cambiare i tempi — quindi la lobby è una destinazione vera e
    // il link funziona. **L'owner che non gioca no** (⚠ P11): non è membro,
    // quindi non viene spinto da nessuna parte, e per lui la lobby ad asta in
    // corso è la lista dei partecipanti con i loro pallini.
    visibleTo: (v, a) =>
      (v.isOwner || v.isMember) && !(v.isMember && a.status === "LIVE"),
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
    // «Asta live» e non «Portale»: chi legge un menù vuole sapere cosa trova,
    // non come si chiama il contenitore. La rotta resta `play` — rinominarla
    // cambierebbe un URL che la gente ha già aperto durante un'asta.
    label: "Asta live",
    title: "Asta live",
    visibleTo: (v) => v.isMember,
  },
  {
    key: "log",
    segment: "log",
    // «Storico» e non «Log»: la pagina la apre chi sta discutendo di un lotto,
    // non chi cerca un file di sistema.
    label: "Storico",
    title: "Storico dell'asta",
    // Owner **e** membri (M3 §3). Un partecipante che vuole contestare un lotto
    // deve poterlo guardare da sé; e le buste non si rivedono da nessun'altra
    // parte dopo i secondi di reveal — tanto meno se è stato premuto «Prosegui
    // asta», che quei secondi li salta. È I10: una schermata non deve essere
    // raggiungibile solo da chi era connesso al momento giusto.
    visibleTo: (v) => v.isOwner || v.isMember,
  },
];

/** Le sezioni che questo viewer può raggiungere, nell'ordine della sotto-navbar. */
export function auctionSections(
  viewer: NavViewer,
  auction: NavAuction,
): AuctionSection[] {
  return SECTIONS.filter((section) => section.visibleTo(viewer, auction)).map(
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
 *
 * ⚠ **Legge il catalogo intero e non passa da `auctionSections`**, ed è la
 * riga che tiene in piedi la restrizione di M16. Una sezione può essere
 * *nascosta dal menù* e *raggiunta lo stesso* — la Lobby ad asta `LIVE` è
 * esattamente quel caso, perché il link sparisce ma l'URL funziona ancora e
 * l'owner che non gioca ci vive. Se il titolo venisse cercato fra le voci
 * visibili, quella pagina perderebbe la propria intestazione proprio nello
 * stato in cui la voce è nascosta: si leggerebbe il nome dell'asta al posto di
 * «Lobby», che è il ripiego di `AuctionNav` quando non riconosce la rotta.
 *
 * Fino a M16 la distinzione non esisteva — le voci erano tutte raggiungibili e
 * il trucco era chiedere le sezioni di un viewer onnipotente — e adesso esiste.
 */
export function activeSection(pathname: string): AuctionSection | null {
  const parts = pathname.split("/").filter((part) => part !== "");
  // ["auctions", "<id>", "<segmento>"] — meno di tre pezzi vuol dire che siamo
  // sulla lista delle aste o su una rotta che con l'asta non c'entra.
  if (parts.length < 3 || parts[0] !== "auctions") return null;
  const section = SECTIONS.find((s) => s.segment === parts[2]);
  if (section === undefined) return null;
  const { key, segment, label, title } = section;
  return { key, segment, label, title };
}
