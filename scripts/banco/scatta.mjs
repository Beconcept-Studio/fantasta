// Screenshot via CDP: stessa strada della misura, così quello che vedo e quello
// che misuro sono la stessa pagina. `--screenshot` di Chrome headless dava un
// risultato diverso dal DOM misurato, e a quel punto non è più una prova.
const [, , url, out, wStr, hStr, mobile] = process.argv;
const w = Number(wStr), h = Number(hStr);
const r = await fetch("http://127.0.0.1:9222/json/new?" + encodeURIComponent(url), { method: "PUT" });
const t = await r.json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise((res) => (ws.onopen = res));
await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: mobile === "1" });
await new Promise((r) => setTimeout(r, 2500));
const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
const fs = await import("node:fs");
fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log("scritto", out);
await fetch(`http://127.0.0.1:9222/json/close/${t.id}`);
process.exit(0);
