#!/usr/bin/env python3
"""Genera le icone dell'applicazione dai PNG sorgente. Si dà a mano, una volta.

    python3 scripts/genera-icone.py

⚠ **Le sorgenti sono due, e non è una ridondanza da risolvere**: sono due lavori
diversi, e dal 2026-08-28 lo dicono anche a occhio.

    fixtures/logo.png          1080×1080, tela piena, opaco: il marchio bianco su
                               un gradiente verde → giallo → blu notte con la
                               grana. È **l'app**: l'icona sulla schermata home,
                               dove c'è spazio e serve una tessera riconoscibile.

    fixtures/logo-favicon.png  2257×3204, **trasparente fuori dal disegno**: il
                               marchio verde da solo, con i suoi contorni scuri.
                               È **la linguetta del browser**, dove il disegno
                               vive a 16 pixel e un gradiente con la grana
                               diventa una macchia. (Il master vettoriale è
                               `fixtures/logo-favicon.svg`, tenuto accanto ma non
                               usato: rasterizzarlo vorrebbe dire aggiungere una
                               dipendenza per un guadagno che a 16px non c'è.)

Scrive **cinque** file, e adesso da due sorgenti:

    app/favicon.ico        16 + 32 + 48, scritto byte per byte   ← logo-favicon
    app/icon.png           512, RGBA — Next lo trova per nome    ← logo-favicon
    app/apple-icon.png     180  — RGB, senza canale alpha        ← logo
    public/icon-192.png    192  ┐ le due icone del manifest, che ← logo
    public/icon-512.png    512  ┘ vogliono un URL **stabile**    ← logo

⚠ **`app/icon.png` e `public/icon-512.png` non hanno più gli stessi byte**, e fino
al 2026-08-27 li avevano — la nota che lo diceva, qui e in `public/README.md`, è
stata riscritta apposta. La divergenza è **voluta**: il primo è la linguetta, il
secondo è la tessera che il telefono mette sulla schermata home. Chi un giorno
notasse i due file diversi e li «riallineasse» spegnerebbe esattamente la
distinzione che questa versione ha introdotto.

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

**Perché la linguetta ha una sorgente sua** (2026-08-28, richiesta dell'owner):
l'icona di M20 è nata per la schermata home e lì funziona; a 16 pixel, in una
linguetta, un gradiente con la grana perde il marchio e resta una macchia di
colore. Il disegno nuovo è il contrario: campiture piatte, nessuna grana, contorni
netti. Le tre misure dell'ICO sono state **guardate ingrandite su fondo chiaro e
su fondo scuro** prima di scegliere il margine.

**Cosa era cambiato con M20**, rispetto alla ricetta di `v1.15.1` — che partiva da
`fixtures/favicon-512.png`, un cerchio blu su fondo trasparente, adesso
cancellato:

  * l'**appiattimento** dell'icona di iOS non serve più. L'alpha di `logo.png` è
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
SORGENTE_TAB = "fixtures/logo-favicon.png"

#: Quanto respiro lascia il marchio della linguetta ai bordi della tela quadrata.
#: **Scelto guardando** le tre misure ingrandite su fondo chiaro e su fondo scuro
#: (2026-08-28): a zero il disegno tocca i bordi e in un contesto con gli angoli
#: arrotondati rischia il taglio; al 10% a 16 pixel il marchio perde peso e la
#: linguetta diventa smorta. Il 4% è il punto in cui non tocca e non si rimpicciolisce.
MARGINE_TAB = 0.04


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


def quadrata(src, n, margine=MARGINE_TAB):
    """Il marchio della linguetta, centrato in una tela quadrata **trasparente**.

    ⚠ **Serve perché la sorgente non è quadrata**, e una favicon lo è per forza:
    `logo-favicon.png` è 2257×3204, cioè un rapporto di 0,704, e il disegno arriva
    a filo su tutti e quattro i lati (il riquadro dell'inchiostro *è* l'immagine,
    misurato). Si adatta quindi l'**altezza** e la larghezza viene da sé: il
    marchio occupa il 92% della tela in verticale e il 65% in orizzontale, con le
    bande trasparenti ai lati.

    ⚠ **La tela resta trasparente**, ed è la ragione per cui questa funzione non
    passa da `salva()`. La barra delle linguette è chiara o scura a seconda del
    tema del sistema: un fondo bianco cucito qui sotto diventerebbe un francobollo
    bianco su una barra scura. Le campiture verdi si leggono su entrambi i fondi,
    e i contorni scuri — che a 16 pixel spariscono comunque — non servono a
    reggere il disegno.
    """
    alt = round(n * (1 - 2 * margine))
    lar = max(1, round(alt * src.width / src.height))
    marchio = src.resize((lar, alt), Image.LANCZOS)
    tela = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    tela.paste(marchio, ((n - lar) // 2, (n - alt) // 2), marchio)
    return tela


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

    tab = Image.open(SORGENTE_TAB).convert("RGBA")
    # Non quadrata di proposito, e verticale: se un giorno arrivasse una sorgente
    # orizzontale, `quadrata()` la adatterebbe comunque all'altezza e uscirebbe un
    # francobollo. Meglio fermarsi e guardare il file.
    if tab.height <= tab.width:
        raise SystemExit(
            f"{SORGENTE_TAB} è {tab.size}: il marchio della linguetta è verticale, "
            "e `quadrata()` adatta l'altezza. Rileggila prima di rigenerare."
        )

    # ⚠ **`public/icon-512.png` non è più lo stesso file di `app/icon.png`**, e la
    # divergenza è il punto di questa versione: la linguetta ha una sorgente sua.
    # Questo resta quello del manifest, che ha bisogno di un URL **stabile** — le
    # rotte generate da `app/` portano un hash che cambia col contenuto.
    salva(giu(src, 512), "public/icon-512.png")

    # ⚠ **`public/icon-192.png` e non `public/icon.png`**: quel nome collide con
    # la rotta `/icon.png` che Next genera da `app/icon.png`. Un rinomino «per
    # pulizia» romperebbe l'installazione, e il perché è scritto anche accanto ai
    # file, in `public/README.md`.
    salva(giu(src, 192), "public/icon-192.png")

    apple_icon(src).save("app/apple-icon.png", optimize=True)

    # ⚠ **Le due icone della linguetta, e sono due perché i browser scelgono da
    # sé.** `favicon.ico` è la strada vecchia e universale; `app/icon.png` è il
    # `<link rel="icon">` che Next emette per convenzione di nome, e Chrome
    # preferisce spesso quello. Cambiarne uno solo vorrebbe dire vedere l'icona
    # nuova su un browser e la vecchia su un altro — che è il modo in cui si
    # rilascia una favicon e si crede che non abbia funzionato.
    #
    # Qui **non** si passa da `salva()`: quella toglie il canale alpha, e la
    # trasparenza è tutto il punto (vedi `quadrata`).
    quadrata(tab, 512).save("app/icon.png", optimize=True)
    scrivi_ico([quadrata(tab, n) for n in (16, 32, 48)], "app/favicon.ico")

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
