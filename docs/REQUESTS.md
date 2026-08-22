### Lotto - Rimozione valori suggeriti e Ritiro offerta
Nel modale con la input per effettuare l'offerta rimuovere i valori consigliati (+10, +25, max, etc.). Tenere solo -1 / +1 vicino alla input.
Rimuovere inoltre la possibilità di rimuovere un'offerta fatta. Chi fa un'offerta la tiene, al massimo può sovrascriverla.

### Refactor UI elementi
#### Asta live
- Desktop: il main vorrei fosse su tre colonne, con max-w-6xl come gli altri contenitori. Colonna 1: inglobo <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-40 border-b backdrop-blur"> e lo metto in una card + sezione "La tua rosa" . Colonna 2: Sezione "Gli altri". Colonna 3: lo status dell'asta, tutte le card che parlano del lotto, dello stato del lotto, etc.
- Turno di chiamata: quando è il mio turno non devo vedere tutto nel layout a tre colonne, ma deve apparire un pannello overlay come quello del lotto live per fare l'offerta (pinnato sul basso della viewport) che mi fa scegliere il giocatore. Una volta scelto il pannello si chiude ed appare l'altro pannello per fare l'offerta.
- Tutte le box della colonna 3 devono essere maggiormente evidenziate per mostrare in modo più chiaro lo status dell'asta. Non vuole dire utilizzare font più grandi, ma una miglior scelta sulla palette in modo che a colpo d'occhio si capisca cosa sta succedendo. Le UI dovrebbero avere label, badge di stato, etc. sempre nello stesso luogo in card per essere più facilmente percepibili i cambiamenti.

#### TV
- voglio vedere lo status dei partecipanti (verde: live - rosso: offline)