/**
 * Una data in italiano, o «mai».
 *
 * ⚠ **`Europe/Rome` è esplicito, e non è pignoleria: il server gira in UTC**,
 * processo compreso (PLAN §17). Senza il fuso, un caricamento delle 23:30
 * comparirebbe come del giorno prima — e la data di ultimo aggiornamento del
 * listone è *il* punto della richiesta di M10 («si indica data di ultimo
 * aggiornamento così può decidere se vuole usare quello»): sbagliata di un
 * giorno, fa scartare un listone buono.
 *
 * Vive qui, e non dentro una pagina, perché da M10 i chiamanti sono **tre**: il
 * pannello del listone, la proposta alla creazione di un'asta e il pulsante nel
 * setup (regola 8 — il secondo chiamante è arrivato). Zero dipendenze: la
 * proposta è un client component, e deve poterla leggere senza portarsi dietro
 * altro.
 */
export function when(value: Date | null): string {
  if (value === null) return "mai";
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  }).format(value);
}

/**
 * Solo il giorno, senza l'ora: «12 agosto 2026».
 *
 * È la forma che sta bene dentro una frase — «aggiornato il 12 agosto 2026» —
 * dove l'ora sarebbe rumore. Quando serve sapere *quale* dei due caricamenti di
 * oggi si sta guardando, si usa `when`.
 */
export function whenDay(value: Date): string {
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "long",
    timeZone: "Europe/Rome",
  }).format(value);
}
