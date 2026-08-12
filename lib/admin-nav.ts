/**
 * Il vocabolario della navigazione del pannello di amministrazione (M6).
 *
 * È costruito sul modello di `lib/auction-nav.ts`, e per la stessa ragione, che
 * è un bug vero: prima di M2 ogni pagina si scriveva i propri link a mano, e
 * nell'intestazione della configurazione la voce «Pannello di configurazione»
 * puntava alla lobby. Un'etichetta e una destinazione tenute insieme da
 * nient'altro che l'attenzione divergono, prima o poi. Qui **etichetta, titolo e
 * segmento di URL escono dalla stessa riga**: il titolo in cima alla pagina e la
 * voce da cui ci sei arrivato non possono raccontare due cose diverse.
 *
 * Zero dipendenze, come il suo gemello: la sidebar è un client component —
 * legge il pathname per evidenziare la voce attiva — e deve poter leggere questo
 * file senza portarsi l'ORM nel bundle.
 *
 * ⚠ **Nessun parametro `viewer`**, a differenza di `auctionSections`. Là le
 * sezioni dipendono dal ruolo perché nella stessa asta convivono owner e
 * partecipanti; qui il ruolo è uno solo. Chi non è amministratore non vede il
 * pannello affatto, e non perché una voce sia nascosta: lo fermano
 * `requireAppAdmin()` nel layout **e in ogni server action** (M6 §5). Una
 * navigazione che filtra è una navigazione che qualcuno confonderà per una
 * difesa.
 */

/** La radice del pannello. Il pulsante in navbar punta qui. */
export const ADMIN_ROOT = "/admin";

export const ADMIN_SECTION_KEYS = [
  "users",
  "auctions",
  "figurine",
  "listone",
] as const;
export type AdminSectionKey = (typeof ADMIN_SECTION_KEYS)[number];

export type AdminSection = {
  key: AdminSectionKey;
  /** Il segmento dopo `/admin/`. */
  segment: string;
  /** La voce nella sidebar. */
  label: string;
  /** Il titolo in cima alla pagina. */
  title: string;
};

/**
 * L'ordine è quello con cui si guarda l'applicazione dall'alto: prima le
 * persone, poi le partite, poi le cose che si vedono giocando. E la prima voce
 * è anche dove atterra `/admin`, che la ricava da qui invece di ripetere una
 * stringa.
 *
 * I titoli sono al plurale e con «tutti»: in dashboard c'è «Le tue aste», qui
 * «Tutte le aste». La differenza fra le due schermate è esattamente quella, e
 * conviene che si legga nel titolo.
 *
 * ⚠ **Le figurine sono in fondo perché sono l'unica voce che non parla di
 * righe del database** (M7): è un archivio di file, globale, che sopravvive
 * alla cancellazione di un'asta. Il segmento è in italiano — `figurine` — a
 * differenza degli altri due, e non è una svista: `campioncini` è il nome che
 * usa il CDN di Fantacalcio.it, «figurina» è la parola che si usa nella stanza.
 * Il codice parla la prima lingua, la navigazione la seconda.
 *
 * ⚠ **«Listone» sta dopo «Figurine» per la stessa ragione** (M8): è l'altra voce
 * che non parla di righe legate a un'asta. Le due si somigliano — un archivio
 * globale riempito da un pulsante, che sopravvive alle aste — ma quella che
 * conta di più sta prima, e a schermo una figurina si vede da tre metri mentre
 * una percentuale di titolarità si legge col telefono in mano.
 */
const SECTIONS: AdminSection[] = [
  {
    key: "users",
    segment: "users",
    label: "Utenti",
    title: "Tutti gli utenti",
  },
  {
    key: "auctions",
    segment: "auctions",
    label: "Aste",
    title: "Tutte le aste",
  },
  {
    key: "figurine",
    segment: "figurine",
    label: "Figurine",
    title: "Le figurine dei calciatori",
  },
  {
    key: "listone",
    segment: "listone",
    label: "Listone",
    title: "Gli insight sul listone",
  },
];

/** Le sezioni del pannello, nell'ordine della sidebar. */
export function adminSections(): AdminSection[] {
  return SECTIONS.map(({ key, segment, label, title }) => ({
    key,
    segment,
    label,
    title,
  }));
}

export function adminSectionHref(section: AdminSection): string {
  return `${ADMIN_ROOT}/${section.segment}`;
}

/**
 * La sezione a cui appartiene un pathname, o `null` se siamo fuori dal pannello.
 *
 * Ricavarla dall'URL invece di farsela dichiarare da ogni pagina è ciò che
 * rende impossibile a una pagina mentire su dove si trova: il titolo lo decide
 * la rotta, e la rotta è quella nella barra degli indirizzi.
 *
 * ⚠ Il primo segmento va confrontato con `admin`, non cercato dentro il
 * pathname: `/auctions` e `/admin/auctions` finiscono con lo stesso segmento, e
 * la lista delle proprie aste non deve accendere la voce del pannello.
 */
export function activeAdminSection(pathname: string): AdminSection | null {
  const parts = pathname.split("/").filter((part) => part !== "");
  // ["admin", "<segmento>"] — un pezzo solo è la radice, che reindirizza.
  if (parts.length < 2 || parts[0] !== "admin") return null;
  return SECTIONS.find((section) => section.segment === parts[1]) ?? null;
}
