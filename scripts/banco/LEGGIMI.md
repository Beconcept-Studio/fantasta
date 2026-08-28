# Guardare una pagina, e misurarla

⚠ **Roba di M21-02, si cancella insieme a `app/banco/` (M21-13).**

`chrome --headless --screenshot --window-size=375` **impagina a ~800px e poi ritaglia**: mostra
una pagina che non esiste. Durante M21-02 ci ho creduto abbastanza da «correggere» un difetto
inesistente — il `PMA` sembrava fuori schermo e non lo era. Uno screenshot che non concorda con la
misura del DOM non è una prova.

Questi due passano da CDP, cioè dallo stesso contesto in cui si misura: `setDeviceMetricsOverride`
e poi `captureScreenshot`.

```bash
# 1. Chrome con la porta di debug aperta (una volta sola, resta acceso)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-banco about:blank &

# 2. Uno screenshot: url, file, larghezza, altezza, mobile(1|0)
node scripts/banco/scatta.mjs http://localhost:3000/banco/telefono /tmp/tel.png 375 800 1

# 3. Una misura sul DOM (l'espressione da valutare si edita dentro il file)
node scripts/banco/misura.mjs http://localhost:3000/banco
```

⚠ **Il dev server va acceso su un database usa-e-getta**, non su quello di sviluppo: in `asta` c'è
una simulata lasciata `LIVE`, e accendere `pnpm dev` la rimette in moto e le consuma i lotti.

```bash
docker exec fantasta-db psql -U postgres -c "CREATE DATABASE asta_banco;"
sed 's|/asta"|/asta_banco"|' .env > /tmp/.env.banco
DATABASE_URL=$(grep -E '^DATABASE_URL' /tmp/.env.banco | cut -d= -f2- | tr -d '"') pnpm exec drizzle-kit push --force
env $(grep -E '^DATABASE_URL' /tmp/.env.banco | xargs) pnpm dev
```
