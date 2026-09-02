"use client";

import { Dialog } from "radix-ui";
import { Upload } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { uploadUserListoneAction } from "@/app/auctions/[id]/play/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { UserListoneStatus } from "@/lib/engine/user-listone";

/**
 * Il modale «Importa obiettivi» (M21 §6): il proprio foglio, per sé.
 *
 * ⚠ **È il gemello del caricamento dell'amministratore, non una sua versione
 * ridotta.** Stesso file, stesso parser, stesso aggancio per nome, e **lo stesso
 * riepilogo**: righe scritte su righe lette, i nomi non agganciati, le squadre
 * discordanti. Chi carica il proprio file ha lo stesso diritto di capire perché è
 * andato storto — e qui in più c'è il conteggio degli obiettivi, che è la cosa
 * per cui il caricamento esiste.
 *
 * ⚠ **Non si conserva niente** (P6): il file viene letto e buttato, e a database
 * restano le righe agganciate.
 *
 * ⚠ **Il dato ricompare in tabella perché l'azione revalida la pagina**, non
 * perché arrivi dallo stream: il listone viaggia su `listPickPool`, che è una
 * prop letta all'apertura della pagina. Il perché sta sulla Server Action.
 */
export function ListoneImport({
  auctionId,
  status,
}: {
  auctionId: string;
  /** Cosa c'è già a sistema per me: `rows: 0` è chi non ha mai importato. */
  status: UserListoneStatus;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, running] = useActionState(
    uploadUserListoneAction,
    EMPTY_FORM_STATE,
  );

  // ⚠ Il modale **non si chiude da sé** quando il caricamento riesce, ed è
  // deliberato: il riepilogo è la parte che va letta — dieci nomi non agganciati
  // dicono che il foglio e il listone hanno cominciato a divergere — e chiudere
  // sull'esito lo farebbe sparire nel momento in cui compare. Si chiude a mano.
  // Quello che si azzera da sé è il campo, così un secondo tentativo non riparte
  // dal file di prima.
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (state.ok) setKey((k) => k + 1);
  }, [state.ok]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline" size="sm">
          <Upload />
          <span className="hidden sm:inline">Importa obiettivi</span>
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="bg-card fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl border p-4">
          <div className="space-y-1">
            <Dialog.Title className="font-semibold">
              Importa i tuoi obiettivi
            </Dialog.Title>
            <Dialog.Description className="text-muted-foreground text-sm">
              Il tuo foglio in <span className="font-mono">.xlsx</span>: quattro
              fogli <span className="font-mono">P</span>,{" "}
              <span className="font-mono">D</span>,{" "}
              <span className="font-mono">C</span>,{" "}
              <span className="font-mono">A</span>, con la colonna{" "}
              <span className="font-mono">Obiett.</span> e la fascia. Si aggancia
              al listone per nome. Il file non viene conservato, e quello che
              importi <strong>vale solo per te</strong>.
            </Dialog.Description>
          </div>

          {status.rows > 0 && (
            <p className="text-muted-foreground text-xs">
              Adesso hai {status.rows} giocatori e {status.obiettivi} obiettivi,
              da un file caricato il{" "}
              {status.uploadedAt === null
                ? "—"
                : new Intl.DateTimeFormat("it-IT", {
                    day: "numeric",
                    month: "long",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Europe/Rome",
                  }).format(status.uploadedAt)}
              . Un nuovo caricamento <strong>sostituisce</strong> questi.
            </p>
          )}

          <form action={action} className="space-y-3">
            <input type="hidden" name="auctionId" value={auctionId} />
            <div className="space-y-1.5">
              <Label htmlFor="listone-personale" className="sr-only">
                Il tuo foglio (.xlsx)
              </Label>
              <Input
                key={key}
                id="listone-personale"
                name="file"
                type="file"
                accept=".xlsx"
                required
              />
            </div>

            {state.error !== null && (
              <p className="text-destructive text-sm">{state.error}</p>
            )}
            {state.ok && (
              <div className="bg-muted/60 space-y-1 rounded-lg p-3 text-xs">
                <p>{state.ok}</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline">
                  {state.ok ? "Chiudi" : "Annulla"}
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={running}>
                {running ? "Importo…" : status.rows > 0 ? "Sostituisci" : "Importa"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
