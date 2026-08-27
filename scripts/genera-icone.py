#!/usr/bin/env python3
"""Genera le icone dell'applicazione dal PNG sorgente. Si dà a mano, una volta.

    python3 scripts/genera-icone.py

Sorgente: `fixtures/logo.png` — 1080×1080 PNG RGBA con **l'alpha interamente
opaco** (min e max entrambi 255), il marchio bianco al centro su un gradiente
verde → giallo → blu notte con la grana. Il riquadro del bianco misura il 34% in
orizzontale e il 46% in verticale, centrato esatto.

Scrive **cinque** file, per **due** consumatori diversi:

    app/favicon.ico        16 + 32 + 48, scritto byte per byte
    app/icon.png           512  — Next lo trova per convenzione di nome
    app/apple-icon.png     180  — RGB, senza canale alpha
    public/icon-192.png    192  ┐ le due icone del manifest, che hanno bisogno
    public/icon-512.png    512  ┘ di un URL **stabile** (M20 §3)

⚠ **Non fa parte della build, e non deve entrarci.** Nessuno lo chiama: né la
build, né `tsc`, né ESLint lo guardano. Le icone cambiano una volta all'anno, e i
cinque file che produce sono **committati** — sono asset, non un passo di
pipeline. Sta qui perché il giorno che l'icona cambia non si debba ricostruire il
ragionamento.

Vuole Python 3 con Pillow, che **non sono e non devono diventare dipendenze del
progetto**: `pnpm install` non li installa e non gli servono. ⚠ E `sharp`, che
sarebbe la scelta ovvia in un progetto Node, non è utilizzabile qui: c'è sotto
`node_modules/.pnpm` perché lo porta Next.js, ma con `pnpm` non è issato, quindi
un `require("sharp")` dalla radice risponde `MODULE_NOT_FOUND`.

**Cosa è cambiato con M20**, rispetto alla ricetta di `v1.15.1` — che partiva da
`fixtures/favicon-512.png`, un cerchio blu su fondo trasparente, adesso
cancellato:

  * l'**appiattimento** dell'icona di iOS non serve più. L'alpha della sorgente è
    già opaco a tela piena, quindi il difetto che quel codice esisteva per evitare
    — iOS che riempie la trasparenza di nero e mette gli angoli neri attorno al
    disegno — non è più possibile. Resta una conversione a RGB;
  * il **192** compare, e prima era saltato *di proposito*: serviva a un manifest,
    e l'applicazione non ne aveva uno (`DECISIONS.md` 2026-08-18). Adesso ce l'ha;
  * **nessun ritaglio**: tela piena. Le rese sono state guardate ingrandite, tela
    piena contro un ritaglio stretto, e ha vinto la tela piena — a 32 e 48 il
    marchio è già netto, e il ritaglio a misura grande **perde il blu notte**,
    cioè darebbe due icone visibilmente diverse per la stessa app;
  * **niente maschera di contrasto**, come prima e per la stessa ragione: non c'è
    dettaglio fine da recuperare, e su un bordo antialiasato produce solo un alone.
"""

import struct

from PIL import Image

SORGENTE = "fixtures/logo.png"


def giu(src, n):
    """Riduzione con LANCZOS, e **senza** maschera di contrasto.

    Sulla sorgente di due icone fa — un pallone da calcio coi pentagoni disegnati
    — una maschera leggera serviva, perché a 16 pixel il dettaglio fine diventa
    una pappa. Qui il disegno è un marchio geometrico su una campitura di colore:
    non c'è nessun dettaglio da recuperare, e una maschera di contrasto su un
    bordo antialiasato produce solo un alone. Se un giorno la sorgente torna a
    essere un disegno con dei dettagli, è questo il punto in cui rimetterla.
    """
    return src.resize((n, n), Image.LANCZOS)


def salva(im, percorso):
    """Scrive un PNG **senza canale alpha**, e non è un dettaglio di forma.

    ⚠ La sorgente ha l'alpha a 255 su **tutta** l'immagine (verificato: min e max
    entrambi 255), cioè un canale che non porta informazione — e che senza un
    `convert` finirebbe comunque dentro ogni file, compresso ma presente. Misurato
    su questa sorgente: il 512 passa da **510 a 431 KB** e il 192 da 60 a 48. Sono
    89 KB in meno per file committato e per file che il telefono scarica quando
    l'app si installa.

    Il PNG resta grosso comunque, e la ragione va saputa prima di sospettare un
    errore: la **grana** del gradiente è rumore, e il rumore è esattamente ciò che
    un compressore senza perdita non può togliere. Un'icona pulita della stessa
    misura pesa qualche decina di KB.
    """
    im.convert("RGB").save(percorso, optimize=True)


def apple_icon(src):
    """L'icona di iOS: 180×180 e **senza canale alpha**.

    ⚠ **Qui non si appiattisce più niente, ed è la sorgente che è cambiata.** Fino
    a `v1.15.1` questa funzione dipingeva una tela del colore del disegno e ci
    incollava sopra l'icona, perché quella sorgente aveva il fuori-cerchio
    trasparente e iOS riempie la trasparenza di nero da sé, mettendo quattro
    angoli neri attorno al disegno. `fixtures/logo.png` è **opaco a tela piena**:
    non c'è nessuna trasparenza che iOS possa riempire, e l'unica cosa che serve è
    togliere il canale alpha — che a 255 su tutta l'immagine non porta
    informazione, e che senza `convert` finirebbe comunque nel PNG.

    Il giorno che la sorgente tornasse a essere trasparente fuori dal disegno,
    questa funzione va rifatta come era: la si ritrova con
    `git show v1.19.2:scripts/genera-icone.py`.
    """
    return giu(src, 180).convert("RGB")


def blocco_bmp(im):
    """Un'icona nella forma che l'ICO si aspetta: intestazione, pixel BGRA dal
    basso verso l'alto, poi la maschera 1bpp con le righe allineate a 4 byte.

    La maschera esce tutta a zero con questa sorgente — l'alpha è opaco — e va
    scritta comunque: il formato la vuole, e l'altezza dichiarata nell'intestazione
    conta immagine **più** maschera.
    """
    w, h = im.size
    px = im.load()
    xor = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = px[x, y]
            xor += bytes((b, g, r, a))
    passo = ((w + 31) // 32) * 4
    mask = bytearray()
    for y in range(h - 1, -1, -1):
        riga = bytearray(passo)
        for x in range(w):
            if px[x, y][3] < 128:
                riga[x // 8] |= 0x80 >> (x % 8)
        mask += riga
    # BITMAPINFOHEADER: l'altezza è doppia perché conta immagine + maschera.
    intestazione = struct.pack(
        "<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, len(xor) + len(mask), 0, 0, 0, 0
    )
    return intestazione + bytes(xor) + bytes(mask)


def scrivi_ico(misure, percorso):
    """Impila le misure già rese in un ICO multi-risoluzione.

    ⚠ **Scritto a mano di proposito.** `Image.save(..., sizes=[...])` di Pillow
    **ridimensiona da sé** partendo da una sola immagine: butta via le rese
    preparate qui sopra, cioè l'unica ragione per cui un ICO multi-misura esiste
    invece di un PNG solo. Il formato è semplice — intestazione, una voce di
    indice per misura, i blocchi in coda — e scriverlo dà il controllo su cosa
    finisce dentro.
    """
    blocchi = [blocco_bmp(im) for im in misure]
    offset = 6 + 16 * len(blocchi)
    out = bytearray(struct.pack("<HHH", 0, 1, len(blocchi)))
    for im, blocco in zip(misure, blocchi):
        w, h = im.size
        out += struct.pack(
            "<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(blocco), offset
        )
        offset += len(blocco)
    for blocco in blocchi:
        out += blocco
    with open(percorso, "wb") as f:
        f.write(bytes(out))


def main():
    src = Image.open(SORGENTE).convert("RGBA")
    if src.size != (1080, 1080):
        raise SystemExit(f"{SORGENTE} non è 1080×1080 ma {src.size}")

    # ⚠ **Il 512 esce due volte, dagli stessi byte e da una sola riduzione.**
    # `app/icon.png` la trova Next per convenzione di nome e ne genera il `<link>`
    # da sé; `public/icon-512.png` la dichiara il manifest, che ha bisogno di un
    # URL **stabile** — le rotte generate da `app/` portano un hash che cambia col
    # contenuto. Due consumatori, una sorgente. Il prezzo è dei byte duplicati, e
    # l'alternativa era scrivere `metadata.icons` a mano, cioè tenere allineate
    # due verità per la stessa cosa (M20 §3).
    grande = giu(src, 512)
    salva(grande, "app/icon.png")
    salva(grande, "public/icon-512.png")

    # ⚠ **`public/icon-192.png` e non `public/icon.png`**: quel nome collide con
    # la rotta `/icon.png` che Next genera da `app/icon.png`. Un rinomino «per
    # pulizia» romperebbe l'installazione, e il perché è scritto anche accanto ai
    # file, in `public/README.md`.
    salva(giu(src, 192), "public/icon-192.png")

    apple_icon(src).save("app/apple-icon.png", optimize=True)
    scrivi_ico([giu(src, 16), giu(src, 32), giu(src, 48)], "app/favicon.ico")

    # Il controllo di rilettura: che nell'ICO le tre misure ci siano davvero.
    # ⚠ Su questo file Next dichiarerà `sizes="16x16"`, perché legge la prima voce
    # dell'indice e non tutte e tre. È un'indicazione, non un vincolo — i browser
    # aprono l'ICO e scelgono da sé — e correggerla vorrebbe dire scrivere
    # `metadata.icons` a mano (`DECISIONS.md` 2026-08-18).
    ico = Image.open("app/favicon.ico")
    print("app/favicon.ico       ", sorted(ico.ico.sizes()))
    for nome in (
        "app/icon.png",
        "app/apple-icon.png",
        "public/icon-192.png",
        "public/icon-512.png",
    ):
        im = Image.open(nome)
        print(f"{nome:22} {im.size} {im.mode}")


if __name__ == "__main__":
    main()
