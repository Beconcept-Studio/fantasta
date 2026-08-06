import { describe, expect, it, vi } from "vitest";

/**
 * Non collauda codice applicativo: collauda l'harness. Se questo test passa,
 * i fake timers sono attivi per default (vedi `vitest.setup.ts`) e il tempo nei
 * test lo facciamo passare noi, senza `sleep` reali.
 */
describe("harness dei test", () => {
  it("i timer sono finti: il tempo passa solo se lo facciamo passare noi", () => {
    const fired: string[] = [];
    setTimeout(() => fired.push("scaduto"), 30_000);

    expect(fired).toEqual([]);

    vi.advanceTimersByTime(29_999);
    expect(fired).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(fired).toEqual(["scaduto"]);
  });

  it("anche l'orologio è finto, quindi le scadenze sono deterministiche", () => {
    vi.setSystemTime(new Date("2026-09-01T20:00:00.000Z"));
    const start = Date.now();

    vi.advanceTimersByTime(30_000);

    expect(Date.now() - start).toBe(30_000);
  });
});
