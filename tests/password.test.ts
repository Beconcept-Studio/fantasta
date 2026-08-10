import { describe, expect, it } from "vitest";

import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  hashPassword,
  validatePassword,
  verifyPassword,
} from "@/lib/engine/password";

/**
 * `crypto.scrypt` è nativo e asincrono: gira sul threadpool di libuv, non su
 * un timer. I fake timer di `vitest.setup.ts` non lo toccano, e questi test
 * girano in tempo vero — che per un hash da un decimo di secondo va benissimo.
 */

describe("la politica della password", () => {
  it("rifiuta sotto i dieci caratteri", () => {
    const short = validatePassword("a".repeat(PASSWORD_MIN - 1));
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error.code).toBe("INVALID_PASSWORD");

    expect(validatePassword("a".repeat(PASSWORD_MIN)).ok).toBe(true);
  });

  it("rifiuta sopra i duecento: è il limite dato a scrypt, non una regola di stile", () => {
    expect(validatePassword("a".repeat(PASSWORD_MAX)).ok).toBe(true);
    expect(validatePassword("a".repeat(PASSWORD_MAX + 1)).ok).toBe(false);
  });

  it("non impone maiuscole né simboli", () => {
    expect(validatePassword("tuttominuscolo").ok).toBe(true);
  });

  it("quello che non è una stringa non è una password", () => {
    expect(validatePassword(undefined).ok).toBe(false);
    expect(validatePassword(12345678901).ok).toBe(false);
  });
});

describe("hash e verifica", () => {
  it("va e torna", async () => {
    const hash = await hashPassword("una-password-lunga");
    expect(await verifyPassword("una-password-lunga", hash)).toBe(true);
    expect(await verifyPassword("un'altra-password", hash)).toBe(false);
  });

  it("lo stesso input dà hash diversi: il salt c'è ed è per riga", async () => {
    const a = await hashPassword("una-password-lunga");
    const b = await hashPassword("una-password-lunga");
    expect(a).not.toBe(b);
    // E tutte e due valgono: due salt diversi, la stessa password.
    expect(await verifyPassword("una-password-lunga", a)).toBe(true);
    expect(await verifyPassword("una-password-lunga", b)).toBe(true);
  });

  it("i parametri viaggiano col valore, così alzarli non invalida gli hash di ieri", async () => {
    const hash = await hashPassword("una-password-lunga");
    expect(hash.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(hash.split("$")).toHaveLength(6);
  });

  it("un hash assente o illeggibile è un `false`, non un 500", async () => {
    expect(await verifyPassword("qualunque-cosa", null)).toBe(false);
    expect(await verifyPassword("qualunque-cosa", "")).toBe(false);
    expect(await verifyPassword("qualunque-cosa", "bcrypt$roba")).toBe(false);
    expect(await verifyPassword("qualunque-cosa", "scrypt$a$b$c$d$e")).toBe(
      false,
    );
    // Un `N` assurdo letto da database non deve far allocare gigabyte.
    expect(
      await verifyPassword("qualunque-cosa", "scrypt$999999999$8$1$AAAA$AAAA"),
    ).toBe(false);
  });

  it("un hash prodotto con parametri più bassi resta valido", async () => {
    // È la promessa del formato: il giorno in cui N sale, gli hash vecchi
    // continuano a entrare perché il loro N è scritto dentro di loro.
    const legacy =
      "scrypt$16384$8$1$" +
      Buffer.from("sedici-byte-salt").toString("base64") +
      "$";
    const { scrypt } = await import("node:crypto");
    const derived = await new Promise<Buffer>((resolve, reject) =>
      scrypt(
        "vecchia-password",
        Buffer.from("sedici-byte-salt"),
        32,
        { N: 16384, r: 8, p: 1 },
        (err, key) => (err ? reject(err) : resolve(key)),
      ),
    );
    const stored = legacy + derived.toString("base64");
    expect(await verifyPassword("vecchia-password", stored)).toBe(true);
    expect(await verifyPassword("password-sbagliata", stored)).toBe(false);
  });
});
