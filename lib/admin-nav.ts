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
  "listone",
  "dati",
] as const;
export type AdminSectionKey = (typeof ADMIN_SECTION_KEYS)[number];

export type AdminSection = {
  key: AdminSectionKey;
  /**
   * Il percorso dopo `/admin/`. ⚠ **Può contenere una barra** da M10:
   * `listone/dati` è una voce annidata, e `activeAdminSection` risolve i
   * percorsi a due segmenti scegliendo il match più lungo.
   */
  segment: string;
  /** La voce nella sidebar. */
  label: string;
  /** Il titolo in cima alla pagina. */
  title: string;
  /** La voce sotto cui rientra, per l'indentazione della sidebar. */
  parent?: AdminSectionKey;
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
 * ⚠ **`Figurine` non è più una voce di primo livello** (M10). Fino a v1.10.0 lo
 * era, e stava in fondo perché era «l'unica voce che non parla di righe legate a
 * un'asta»; poi M8 ne ha aggiunta una seconda con la stessa proprietà, e due voci
 * che si somigliano una accanto all'altra erano un pannello cresciuto per
 * accumulo. Adesso le figurine sono un blocco dentro `Listone`: si scaricano
 * **con** un listone appena caricato, ed è lì che quella frase ha un senso.
 *
 * ⚠ **`listone/dati` è la prima voce annidata dell'applicazione**, e il suo
 * segmento ha una barra dentro. Il Centro dati ha una pagina sua perché
 * cinquecento righe con una casella di ricerca non stanno sotto un form di
 * upload, e perché è una pagina che si apre per consultare, non per agire.
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
    key: "listone",
    segment: "listone",
    label: "Listone",
    title: "Il listone a sistema",
  },
  {
    key: "dati",
    segment: "listone/dati",
    label: "Centro dati",
    title: "Centro dati — tutto il listone, con gli insight",
    parent: "listone",
  },
];

/** Le sezioni del pannello, nell'ordine della sidebar. */
export function adminSections(): AdminSection[] {
  return SECTIONS.map(({ key, segment, label, title, parent }) => ({
    key,
    segment,
    label,
    title,
    parent,
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
 *
 * ⚠ **Il match più lungo vince** (M10). Fino a v1.10.0 questa funzione guardava
 * `parts[1]` e basta, perché tutte le sezioni stavano a un segmento; con una
 * voce annidata quella riga accenderebbe «Listone» su `/admin/listone/dati`, e
 * il titolo in cima alla pagina direbbe una cosa mentre la barra degli indirizzi
 * ne dice un'altra. È precisamente il bug per cui questo file esiste.
 */
export function activeAdminSection(pathname: string): AdminSection | null {
  const parts = pathname.split("/").filter((part) => part !== "");
  // ["admin", "<segmento>", …] — un pezzo solo è la radice, che reindirizza.
  if (parts.length < 2 || parts[0] !== "admin") return null;

  const path = parts.slice(1).join("/");
  const matches = SECTIONS.filter(
    (section) => path === section.segment || path.startsWith(`${section.segment}/`),
  );
  if (matches.length === 0) return null;
  return matches.reduce((longest, section) =>
    section.segment.length > longest.segment.length ? section : longest,
  );
}
