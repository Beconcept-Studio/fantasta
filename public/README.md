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

Non a mano e non con un editor di immagini: dalle sorgenti, con lo script che le
produce tutte e cinque insieme.

    python3 scripts/genera-icone.py

⚠ **Le sorgenti sono due, e i due file da 512 non hanno gli stessi byte.** Fino al
2026-08-27 ne bastava una e i due 512 erano identici; adesso no, ed è voluto:

    fixtures/logo.png          → apple-icon, icon-192, icon-512 (**l'app**: la
                                 tessera sulla schermata home, tela piena)
    fixtures/logo-favicon.png  → favicon.ico, app/icon.png (**la linguetta** del
                                 browser: il marchio da solo, fondo trasparente)

A 16 pixel un gradiente con la grana perde il disegno e resta una macchia di
colore: la linguetta ha avuto una sorgente sua il 2026-08-28, su richiesta
dell'owner. Chi notasse i due 512 diversi e li «riallineasse» spegnerebbe proprio
questa distinzione. **`public/icon-512.png` è quello dell'app**, e questa cartella
serve solo il manifest.

## Cosa non va messo qui dentro

Le figurine dei campioncini, che vivono in `/storage` **fuori** da `public/` di
proposito (M7, vedi `lib/campioncini.ts` e il commento in `.gitignore`). Questa
cartella è per gli asset che sono parte dell'applicazione e stanno nel
repository — non per i file che l'applicazione scrive.

⚠ Nota di igiene: tutto ciò che sta in `public/` è **servito**, questo file
compreso (`/README.md`). È documentazione, non c'è niente da proteggere, e stare
accanto ai file è il solo modo in cui questa nota si fa leggere da chi sta per
rinominarli.
