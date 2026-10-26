import { describe, expect, it, vi } from "vitest";
import { decideAccess, VIA } from "./vault-access.cjs";

// The one place that decides "may this card use this vault, and how was it allowed?". The audit log's via
// column has to agree on the words whichever path asked.

describe("decideAccess", () => {
  it("lets a card with a live grant straight through", async () => {
    const grants = { allows: vi.fn(() => true) };
    const ask = vi.fn();
    await expect(decideAccess({ grants, card: "c1", vaultId: "github:o/r", ask })).resolves.toEqual({ allowed: true, via: "grant" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("lets a remembered rule through when there is no grant", async () => {
    const grants = { allows: vi.fn(() => false) };
    const rule = { allows: vi.fn(() => true) };
    await expect(decideAccess({ grants, card: "c1", vaultId: "github:o/r", rule })).resolves.toEqual({ allowed: true, via: "rule" });
  });

  it("asks the user when there is neither a grant nor a rule", async () => {
    const grants = { allows: vi.fn(() => false) };
    const ask = vi.fn(() => Promise.resolve("once"));
    await expect(decideAccess({ grants, card: "c1", vaultId: "github:o/r", ask })).resolves.toEqual({ allowed: true, via: "once" });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("remembers the rule when the user says always", async () => {
    const grants = { allows: vi.fn(() => false) };
    const remember = vi.fn();
    const ask = vi.fn(() => Promise.resolve("always"));
    await expect(decideAccess({ grants, card: "c1", vaultId: "github:o/r", ask, remember })).resolves.toEqual({ allowed: true, via: "always" });
    expect(remember).toHaveBeenCalledTimes(1);
  });

  it("is a no when the user says no", async () => {
    const grants = { allows: vi.fn(() => false) };
    const ask = vi.fn(() => Promise.resolve(null));
    await expect(decideAccess({ grants, card: "c1", vaultId: "github:o/r", ask })).resolves.toEqual({ allowed: false, via: null });
  });

  it("asks the card's own Touch ID for a site and vault that isn't open", async () => {
    const grants = { allows: vi.fn(() => false) };
    const holder = { unlocked: () => false, ensure: vi.fn(() => Promise.resolve(true)) };
    const unlockFor = vi.fn(() => holder);
    await expect(decideAccess({ grants, card: "c1", vaultId: "github:o/r", unlockFor, reason: "let a thread type" })).resolves.toEqual({ allowed: true, via: "touch-id" });
    expect(holder.ensure).toHaveBeenCalledWith("let a thread type");
  });

  it("takes an open Touch ID as already allowed", async () => {
    const grants = { allows: vi.fn(() => false) };
    const holder = { unlocked: () => true, ensure: vi.fn(() => Promise.resolve(true)) };
    await expect(decideAccess({ grants, card: "c1", vaultId: "github:o/r", unlockFor: () => holder })).resolves.toEqual({ allowed: true, via: "unlocked" });
  });

  it("is a no when the Touch ID says no, and says how it was asked about", async () => {
    const grants = { allows: vi.fn(() => false) };
    const holder = { unlocked: () => false, ensure: vi.fn(() => Promise.resolve(false)) };
    await expect(decideAccess({ grants, card: "c1", vaultId: "github:o/r", unlockFor: () => holder })).resolves.toEqual({ allowed: false, via: "touch-id" });
  });

  it("has no word when nothing was asked about", async () => {
    await expect(decideAccess({ card: "c1", vaultId: "github:o/r" })).resolves.toEqual({ allowed: false, via: null });
  });

  it("names the words the audit log uses", () => {
    expect(Object.values(VIA)).toEqual(["grant", "unlocked", "touch-id", "rule", "once", "always"]);
  });
});
