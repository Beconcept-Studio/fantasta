/**
 * `pnpm dev:lan` — il dev server raggiungibile dal telefono (PLAN §15).
 *
 * Non è solo `next dev -H 0.0.0.0`. Quando Next è in ascolto su 0.0.0.0, l'URL
 * che consegna ai route handler ha per host proprio `0.0.0.0`, e Auth.js ci
 * costruisce sopra i suoi redirect: dopo il login il telefono finirebbe su
 * `http://0.0.0.0:3000/`, che è un indirizzo morto. Passando `AUTH_URL` con
 * l'IP di LAN vero il problema non esiste.
 *
 * Lo script trova l'IP da sé e lo stampa, così sul telefono c'è solo da
 * digitarlo.
 */
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

const PORT = process.env.PORT ?? "3000";

function lanAddress(): string | null {
  const candidates: string[] = [];

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      // 169.254.x.x è un link-local: interfaccia su ma senza rete.
      if (address.address.startsWith("169.254.")) continue;
      candidates.push(address.address);
    }
  }

  // Le reti domestiche sono 192.168.x.x; il resto va bene come ripiego.
  return (
    candidates.find((ip) => ip.startsWith("192.168.")) ?? candidates[0] ?? null
  );
}

const ip = lanAddress();

if (!ip) {
  console.error(
    "\n✗ Nessun indirizzo IPv4 di rete locale trovato. Sei connesso al Wi-Fi?\n",
  );
  process.exit(1);
}

const url = `http://${ip}:${PORT}`;

console.log(`\n  Dal telefono, sulla stessa rete Wi-Fi:  ${url}\n`);

const child = spawn(
  "next",
  ["dev", "-H", "0.0.0.0", "-p", PORT],
  {
    stdio: "inherit",
    env: { ...process.env, AUTH_URL: url },
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
