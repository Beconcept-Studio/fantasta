// Entra col login di sviluppo e scatta: apre `/signin`, preme il pulsante di un
// utente, aspetta la dashboard, poi va all'indirizzo chiesto e fotografa.
//
// ⚠ Stessa strada di `scatta.mjs` — CDP, non `--screenshot` — per la ragione
// scritta lì: quello che si vede e quello che si misura devono essere la stessa
// pagina. Roba di M21, si cancella con `app/banco/`.
//
//   node scripts/banco/entra.mjs "Luca Ferrari" /auctions/<id>/play /tmp/a.png 1280 900 0 [click] [tutta]
const [, , nome, path, out, wStr, hStr, mobile, click, tutta] = process.argv;
const w = Number(wStr);
const h = Number(hStr);
const base = "http://localhost:3000";

const r = await fetch(
  "http://127.0.0.1:9222/json/new?" + encodeURIComponent(base + "/signin"),
  { method: "PUT" },
);
const t = await r.json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
};
await new Promise((res) => (ws.onopen = res));
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const evaluate = async (expression) => {
  const out = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return out?.result?.value;
};

await send("Emulation.setDeviceMetricsOverride", {
  width: w,
  height: h,
  deviceScaleFactor: 2,
  mobile: mobile === "1",
});
await wait(2500);

// Il login di sviluppo è una fila di pulsanti con il nome dentro.
const premuto = await evaluate(`(() => {
  const b = [...document.querySelectorAll("button, [role=button]")]
    .find((el) => el.textContent.includes(${JSON.stringify(nome)}));
  if (!b) return "nessun pulsante per ${nome}";
  b.click();
  return "ok";
})()`);
console.log("login:", premuto);
await wait(3000);

await send("Page.navigate", { url: base + path });
await wait(4000);

// Più clic, separati da «|»: la tab e poi il pulsante che apre il modale.
for (const uno of (click ?? "").split("|").filter(Boolean)) {
  // ⚠ `element.click()` **non basta** su una linguetta Radix: quella si attiva su
  // `mousedown`, e `click()` sintetizza solo il `click`. Dieci minuti buttati a
  // guardare uno screenshot in cui la tab non cambiava: si dispacciano i tre
  // eventi veri, come farebbe un dito.
  const fatto = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button, [role=tab]")]
      .find((el) => el.textContent.trim() === ${JSON.stringify(uno)});
    if (!b) return "nessun elemento";
    for (const tipo of ["pointerdown", "mousedown", "mouseup", "click"]) {
      b.dispatchEvent(new MouseEvent(tipo, { bubbles: true, cancelable: true }));
    }
    return "ok";
  })()`);
  console.log("click", uno + ":", fatto);
  await wait(1500);
}

console.log(
  "url:",
  await evaluate("location.pathname"),
  "| scrollWidth:",
  await evaluate("document.documentElement.scrollWidth"),
  "| righe:",
  await evaluate("document.querySelectorAll('tbody tr').length"),
);

const shot = await send("Page.captureScreenshot", {
  format: "png",
  // `tutta` fotografa anche quello che sta sotto la piega; senza, solo il
  // viewport, che è quello che si guarda quando si giudica una schermata.
  captureBeyondViewport: tutta === "tutta",
});
const fs = await import("node:fs");
fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log("scritto", out);
await fetch(`http://127.0.0.1:9222/json/close/${t.id}`);
process.exit(0);
