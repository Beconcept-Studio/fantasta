/**
 * Il riconoscimento di un uuid, prima che arrivi a Postgres (F7-07bis).
 *
 * Il problema che risolve è piccolo e sgradevole: `/api/auctions/undefined/action`
 * — un URL che nessuna pagina genera, ma che una `fetch` scritta a mano in
 * console produce al primo id sbagliato — mandava la stringa `"undefined"` fino
 * al database, che la rifiutava con `invalid input syntax for type uuid`. Una
 * *eccezione*, quindi un **500**: la risposta che l'applicazione riserva ai
 * propri bug. Ma un id inesistente non è un bug del server, è un rifiuto come
 * gli altri, e PLAN §17 vuole un codice tipizzato per ogni rifiuto.
 *
 * Il controllo sta qui, in un file senza dipendenze, e non nei route handler:
 * i punti da difendere non sono le tre rotte con `:id` ma i due imbuti da cui
 * quelle rotte passano — `withAuctionLock` (che serve anche a tutte le azioni)
 * e `resolveViewer` (stream e heartbeat) — più le letture di setup che una
 * pagina può chiamare con un id preso dall'URL. Difendere l'imbuto invece
 * dell'ingresso è ciò che fa valere la regola anche per la prossima rotta che
 * qualcuno aggiungerà.
 *
 * Non valida la *versione* dell'uuid: gli id li genera `gen_random_uuid()` (v4),
 * ma la forma è quella che Postgres accetta, ed è quella che serve non far
 * esplodere.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
