#!/usr/bin/env python3
"""Genera le icone dell'applicazione dal PNG sorgente. Si dà a mano, una volta.

    python3 scripts/genera-icone.py

Sorgente: `fixtures/favicon-512.png` — 512×512 PNG RGBA, un cerchio blu pieno
(`#0000FF`) a tela piena, con il fuori-cerchio trasparente.
Scrive: `app/favicon.ico`, `app/icon.png`, `app/apple-icon.png`.

⚠ **Non fa parte della build, e non deve entrarci.** Nessuno lo chiama: né la
build, né `tsc`, né ESLint lo guardano. Le icone cambiano una volta all'anno, e
i tre file che produce sono **committati** — sono asset, non un passo di
pipeline. Sta qui perché il giorno che l'icona cambia non si debba ricostruire il
ragionamento.

Vuole Python 3 con Pillow, che **non sono e non devono diventare dipendenze del
progetto**: `pnpm install` non li installa e non gli servono. ⚠ E `sharp`, che
sarebbe la scelta ovvia in un progetto Node, non è utilizzabile qui: c'è sotto
`node_modules/.pnpm` perché lo porta Next.js, ma con `pnpm` non è issato, quindi
un `require("sharp")` dalla radice risponde `MODULE_NOT_FOUND`.
"""

import struct

from PIL import Image

SORGENTE = "fixtures/favicon-512.png"

# Il blu del disegno. Serve per appiattire l'icona di iOS: vedi `apple_icon()`.
BLU = (0, 0, 255)


def giu(src, n):
    """Riduzione con LANCZOS, e **senza** maschera di contrasto.

    Sull'icona precedente — un pallone da calcio coi pentagoni disegnati — una
    maschera leggera serviva, perché a 16 pixel il dettaglio fine diventa una
    pappa. Qui il disegno è una campitura piatta con un bordo curvo: non c'è
    nessun dettaglio da recuperare, e una maschera di contrasto su un bordo
    antialiasato produce solo un alone. Se un giorno la sorgente torna a essere
    un disegno con dei dettagli, è questo il punto in cui rimetterla.
    """
    return src.resize((n, n), Image.LANCZOS)


def apple_icon(src):
    """L'icona di iOS: 180×180 e **senza canale alpha**.

    iOS non rispetta la trasparenza — la riempie di nero da sé — e poi ritaglia
    con la sua maschera a quadrato stondato. Lasciarla trasparente significa
    quindi un cerchio blu con gli angoli **neri**, che è il difetto che questo
    file esiste per evitare.

    Si appiattisce sul **blu del disegno** e non sul bianco: così l'unica cosa
    che cambia rispetto alla sorgente sono i quattro angoli che iOS avrebbe
    dipinto di nero, e il colore visibile resta esattamente quello scelto. Il
    bianco sarebbe stato introdurre un colore che nell'originale non c'è, e
    avrebbe reso l'icona «un pallino blu su un cartoncino bianco».
    """
    tela = Image.new("RGB", (180, 180), BLU)
    reso = giu(src, 180)
    tela.paste(reso, (0, 0), reso)
    return tela


def blocco_bmp(im):
    """Un'icona nella forma che l'ICO si aspetta: intestazione, pixel BGRA dal
    basso verso l'alto, poi la maschera 1bpp con le righe allineate a 4 byte."""
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
    if src.size != (512, 512):
        raise SystemExit(f"{SORGENTE} non è 512×512 ma {src.size}")

    # `app/icon.png` è la sorgente a piena misura: Next la trova per convenzione
    # di nome e la dichiara a 512×512. Non c'è una seconda misura a 192 — vedi
    # `docs/DECISIONS.md` alla data: senza un manifest nessuno la sceglierebbe
    # al posto di questa, e si chiamerebbe `icon1.png`.
    src.save("app/icon.png", optimize=True)
    apple_icon(src).save("app/apple-icon.png", optimize=True)
    scrivi_ico([giu(src, 16), giu(src, 32), giu(src, 48)], "app/favicon.ico")

    ico = Image.open("app/favicon.ico")
    print("app/favicon.ico    ", sorted(ico.ico.sizes()))
    for nome in ("app/icon.png", "app/apple-icon.png"):
        im = Image.open(nome)
        print(f"{nome:19} {im.size} {im.mode}")


if __name__ == "__main__":
    main()
