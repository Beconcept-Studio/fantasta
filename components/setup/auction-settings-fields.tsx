"use client";

import { useState } from "react";

import { RoleOrderPicker } from "@/components/setup/role-order-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ROLES, ROLE_LABELS, type Role, SEAT_OPTIONS } from "@/lib/domain";
import { type AuctionConfig, TIMER_LIMITS } from "@/lib/engine/setup-rules";

/**
 * I campi di configurazione di un'asta, condivisi fra la creazione e il setup.
 *
 * `structuralDisabled` spegne tutto ciò che ad asta iniziata non si tocca più
 * (posti, budget, slot, ordine dei ruoli). È solo cortesia verso l'utente: il
 * server rifiuta comunque quelle modifiche (regola 6), e infatti il test che lo
 * dimostra non passa da qui.
 */
export function AuctionSettingsFields({
  defaults,
  structuralDisabled = false,
}: {
  defaults: AuctionConfig;
  structuralDisabled?: boolean;
}) {
  const [seats, setSeats] = useState<number>(defaults.seats);

  return (
    <div className="space-y-6">
      {/*
        Il nome sta dentro un fieldset come tutto il resto della struttura: il
        server lo considera strutturale, e un campo che sembra modificabile ma
        viene rifiutato è peggio di uno spento. Un `fieldset` disabilitato non
        invia i propri campi, quindi ad asta iniziata il nome non parte
        nemmeno.
      */}
      <fieldset className="space-y-2" disabled={structuralDisabled}>
        <Label htmlFor="name">Nome dell&apos;asta</Label>
        <Input
          id="name"
          name="name"
          defaultValue={defaults.name}
          required
          minLength={3}
          maxLength={60}
          placeholder="Lega dei Rossi 2026"
          disabled={structuralDisabled}
        />
      </fieldset>

      <fieldset className="space-y-2" disabled={structuralDisabled}>
        <legend className="text-sm font-medium">Partecipanti</legend>
        <input type="hidden" name="seats" value={seats} />
        <div
          role="radiogroup"
          aria-label="Numero di partecipanti"
          className="bg-muted inline-flex rounded-md p-1"
        >
          {SEAT_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={seats === option}
              disabled={structuralDisabled}
              onClick={() => setSeats(option)}
              className={`min-w-16 rounded px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
                seats === option
                  ? "bg-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          Solo 8, 10 o 12: il numero di posti entra nella validazione del
          listone, non è un campo libero.
        </p>
      </fieldset>

      <Separator />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="budgetDefault">Crediti a testa</Label>
          <Input
            id="budgetDefault"
            name="budgetDefault"
            type="number"
            inputMode="numeric"
            min={1}
            max={10000}
            defaultValue={defaults.budgetDefault}
            disabled={structuralDisabled}
            required
          />
          <p className="text-muted-foreground text-xs">
            Uguale per tutti. Le differenze individuali si fanno dopo, con le
            rettifiche del manager.
          </p>
        </div>
      </div>

      <fieldset className="space-y-3" disabled={structuralDisabled}>
        <legend className="text-sm font-medium">Slot per ruolo</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ROLES.map((role: Role) => (
            <div key={role} className="space-y-1">
              <Label htmlFor={`slots_${role}`} className="text-xs">
                {ROLE_LABELS[role]}
              </Label>
              <Input
                id={`slots_${role}`}
                name={`slots_${role}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={30}
                defaultValue={defaults.slots[role]}
                disabled={structuralDisabled}
                required
              />
            </div>
          ))}
        </div>
      </fieldset>

      <Separator />

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Tempi</legend>
        <p className="text-muted-foreground text-xs">
          Si possono cambiare anche ad asta iniziata: valgono dal lotto
          successivo, non accorciano un countdown in corso.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TimerField
            name="pickSeconds"
            label="Chiamata"
            defaultValue={defaults.pickSeconds}
          />
          <TimerField
            name="bidSeconds"
            label="Offerta"
            defaultValue={defaults.bidSeconds}
          />
          <TimerField
            name="tiePrepSeconds"
            label="Spareggio"
            defaultValue={defaults.tiePrepSeconds}
          />
          <TimerField
            name="revealSeconds"
            label="Buste aperte"
            defaultValue={defaults.revealSeconds}
          />
        </div>

        {/*
          Il cancello dei risultati (M14) sta sotto e non nella griglia dei
          quattro, e non è per larghezza: è l'unico timer che ammette lo zero, e
          lo zero **cambia il numero di fasi dell'asta**. Un campo che in un caso
          accorcia una pausa e in un altro la fa sparire ha bisogno di una riga
          accanto, e in una cella da un quarto di riga quella riga non ci sta.
        */}
        <div className="max-w-xs space-y-1">
          <TimerField
            name="resultGateSeconds"
            label="Prima dei risultati"
            defaultValue={defaults.resultGateSeconds}
          />
          <p className="text-muted-foreground text-xs">
            Quando un round si chiude, le buste restano chiuse per questi
            secondi: puoi mostrarle prima, o mettere in pausa se qualcuno segnala
            un problema. Con <strong>0</strong> non c&apos;è nessuna attesa — i
            risultati escono appena il round chiude, come prima.
          </p>
        </div>
      </fieldset>

      <Separator />

      <fieldset className="space-y-2" disabled={structuralDisabled}>
        <legend className="text-sm font-medium">Ordine dei ruoli</legend>
        <RoleOrderPicker
          defaultValue={defaults.roleOrder}
          disabled={structuralDisabled}
        />
      </fieldset>
    </div>
  );
}

function TimerField({
  name,
  label,
  defaultValue,
}: {
  name: keyof typeof TIMER_LIMITS;
  label: string;
  defaultValue: number;
}) {
  const { min, max } = TIMER_LIMITS[name];
  return (
    <div className="space-y-1">
      <Label htmlFor={name} className="text-xs">
        {label} <span className="text-muted-foreground">(s)</span>
      </Label>
      <Input
        id={name}
        name={name}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        defaultValue={defaultValue}
        required
      />
    </div>
  );
}
