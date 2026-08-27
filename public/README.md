# `public/` — due icone, e il motivo dei nomi

Questa cartella è nata con **M20** e contiene **due file soli**: le icone che
`app/manifest.ts` dichiara. Piatta, senza una sottocartella `icons/`: due file non
sono una cartella.

## Perché stanno qui e non in `app/`

Il manifest deve dichiarare le sue icone con un **URL stabile**. Le rotte che Next
genera dai file dentro `app/` (`app/icon.png` → `/icon.png?<hash>`) portano un
hash che cambia col contenuto: va benissimo per un `<link>` che Next scrive da sé,
non per un URL scritto a mano dentro un manifest.

## ⚠ I nomi non si «puliscono»

    icon-192.png
    icon-512.png

**Non possono chiamarsi `icon.png`**: quel nome collide con la rotta `/icon.png`
che Next genera da `app/icon.png`. Un rinomino per simmetria o per pulizia
**romperebbe l'installazione dell'app** sul telefono, e lo farebbe in silenzio —
in locale il manifest continuerebbe a rispondere, con dentro due URL che danno
404.

Se un giorno cambiano, vanno cambiati **in tre posti insieme**: qui, in
`app/manifest.ts` e in `scripts/genera-icone.py`. Il test `tests/manifest.test.ts`
controlla che i due file dichiarati dal manifest **esistano su disco**, ed è lì
per prendere esattamente questo errore.

## Come si rigenerano

Non a mano e non con un editor di immagini: dalla sorgente, con lo script che le
produce tutte e cinque insieme.

    python3 scripts/genera-icone.py

La sorgente è `fixtures/logo.png`. `public/icon-512.png` ha **gli stessi byte** di
`app/icon.png` — due consumatori diversi, una sola sorgente — e non è una
duplicazione da risolvere: il perché è scritto nello script e in `M20 §3`.

## Cosa non va messo qui dentro

Le figurine dei campioncini, che vivono in `/storage` **fuori** da `public/` di
proposito (M7, vedi `lib/campioncini.ts` e il commento in `.gitignore`). Questa
cartella è per gli asset che sono parte dell'applicazione e stanno nel
repository — non per i file che l'applicazione scrive.

⚠ Nota di igiene: tutto ciò che sta in `public/` è **servito**, questo file
compreso (`/README.md`). È documentazione, non c'è niente da proteggere, e stare
accanto ai file è il solo modo in cui questa nota si fa leggere da chi sta per
rinominarli.
