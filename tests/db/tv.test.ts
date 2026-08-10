import { afterAll, describe, expect, it } from "vitest";

import { loadForSnapshot } from "@/lib/engine/snapshot";
import { auctionByPublicToken } from "@/lib/engine/viewer";

import { makeGameAuction } from "./game-helpers";
import {
  closeDatabase,
  databaseAvailable,
  dropAuctions,
  dropUsers,
} from "./helpers";

/**
 * F6-05 — la porta d'ingresso della vista TV.
 *
 * `/tv/[publicToken]` **non ha login**: il token nell'URL *è* l'autenticazione
 * (PLAN §10). Da qui nasce l'unica cosa che quella pagina deve saper fare prima
 * di collegarsi allo stream — tradurre un token in un'asta — e le due risposte
 * che deve dare: l'asta giusta, oppure niente. Un token inventato non deve
 * poter distinguere «asta inesistente» da «asta esistente ma token sbagliato».
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn("\n⚠ Postgres non raggiungibile: i test della vista TV sono saltati.\n");
}

const createdAuctions: string[] = [];
const createdUsers: string[] = [];

afterAll(async () => {
  if (!dbUp) return;
  await dropAuctions(createdAuctions);
  await dropUsers(createdUsers);
  await closeDatabase();
});

describe.runIf(dbUp)("il token della vista TV", () => {
  it("apre l'asta a cui appartiene, col suo nome", async () => {
    const game = await makeGameAuction({ ownerPlays: false });
    createdAuctions.push(game.auctionId);
    createdUsers.push(...game.userIds, game.ownerId);
    const loaded = await loadForSnapshot(game.auctionId);

    const found = await auctionByPublicToken(loaded!.auction.publicToken);

    expect(found).toEqual({
      id: game.auctionId,
      name: loaded!.auction.name,
      // Da M4 la pagina TV marca le aste di prova, quindi il flag esce di qui.
      // Restano tre campi e non uno di più: il `public_token` non torna
      // indietro da questa funzione, e nemmeno lo stato dell'asta.
      isSimulated: false,
    });
  });

  it("un token inventato non apre niente", async () => {
    expect(await auctionByPublicToken("token-inventato")).toBeNull();
    expect(await auctionByPublicToken("")).toBeNull();
  });
});
