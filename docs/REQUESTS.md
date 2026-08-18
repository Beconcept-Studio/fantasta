### Admin - Refactor pagina utenti
Voglio migliorare la tabella.
Per ogni utente voglio vedere in tabella:
- Email
- Nome
- Email verificata: Si/No
- Admin: Si/No
- Pro: Si/No
- BTN "Vedi"

Tutti i dati devono avere il giusto spazio per essere visualizzati.
I dati in tabella sono in sola visualizzazione.
Nel head della tabella voglio anche una input per cercare l'utente per nome o email.

Il BTN "Vedi" apre un side modal con il recap di tutte le informazioni (anche quelle non mostrare in tabella), e la possibilità di modificare i dati.
Tutti i flag si/no devono essere dei switch On/off (https://ui.shadcn.com/docs/components/base/switch)
In quel modal una volta salvate le info si chiude il modal e si aggiorna la tabella.

### BTN Apri risultati post conclusione lotto
Quando un lotto termina, al momento viene mostrato subito il vincitore con le relative offerte.
Questo fa si che nel caso ci fosse un problema (ES: un partecipante perde la connessione non per suoi problemi) le offerte verranno subito svelate.
Vorrei che al termine del lotto ci siano due BTN:
- "Mostra risultati": con timer di Xs (se entro Xs non viene premuto si scatena in automatico la visione dei risultati). Questo valore va definito dall'admin durante la configurazione dell'asta
- "Asta in pausa": mette in pausa l'asta, così nel caso un utente segnali un problema l'admin può bloccare la visualizzazinoe dei risultati. Nel caso il bottone venga premuto lo stesso bottone deve tramutarsi in "Riprendi asta" che riattiva tutto, e deve apparire un BTN "annulla lotto". "Annulla lotto" è una sorta di reset del lotto: l'utente che ha scelto il calciatore del lotto annullato è di nuovo il proprietario del turno. Anche il calciatore estratto durante il lotto annullato torna disponibile.
Questa azione va segnalata nel log.
