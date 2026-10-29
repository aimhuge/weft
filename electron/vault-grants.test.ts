// Standing vault access for one thread (electron/vault-grants.cjs): after one Touch ID a card may use one project's
// vault for an hour, and the vault's grant methods ask for it, keep it, and end it.
import { describe, expect, it, vi } from "vitest";
import { createGrants, grantMethods, GRANT_MS } from "./vault-grants.cjs";

// The vault's id and label for a folder, as the module asks for it.
const idOf = () => Promise.resolve({ id: "github:o/r", label: "o/r" });

// What a grant asks for: the card it's for, the thread's title and why it wants the vault.
type GrantAsk = { card: string; thread?: string; why?: string; by?: string };

// The grants, the vault's methods on them, and the fakes around them.
function make({ now = () => 1000, ms = GRANT_MS, allow = true } = {}) {
  const grants = createGrants({ now, ms });
  const log = vi.fn(() => true);
  const asked: string[] = [];
  const prompt = vi.fn((reason: string) => {
    asked.push(reason);
    return Promise.resolve(allow);
  });
  const methods = grantMethods({ grants, prompt, idOf, log });
  // thread and why are optional in the module; its inferred signature wants them, so the ask is typed here.
  const grant = (folder: string, ask: GrantAsk) => methods.grant(folder, ask);
  return { grants, methods, grant, log, prompt, asked };
}

describe("createGrants", () => {
  it("allows a card while the grant is live and not after it passes", () => {
    let t = 0;
    const grants = createGrants({ now: () => t, ms: 1000 });
    expect(grants.allows("c1", "github:o/r")).toBe(false);
    grants.add({ card: "c1", thread: "Site", id: "github:o/r", label: "o/r" });
    expect(grants.allows("c1", "github:o/r")).toBe(true);
    t = 1001;
    expect(grants.allows("c1", "github:o/r")).toBe(false);
  });

  it("allows nothing without a card or an id", () => {
    const grants = createGrants({ now: () => 0 });
    grants.add({ card: "c1", thread: "Site", id: "github:o/r", label: "o/r" });
    expect(grants.allows("", "github:o/r")).toBe(false);
    expect(grants.allows("c1", "")).toBe(false);
  });

  it("adds a grant that lasts an hour from now", () => {
    const grants = createGrants({ now: () => 5000 });
    const g = grants.add({ card: "c1", thread: "Site", id: "github:o/r", label: "o/r" });
    expect(g).toEqual({ card: "c1", thread: "Site", id: "github:o/r", label: "o/r", at: 5000, until: 5000 + GRANT_MS });
    expect(GRANT_MS).toBe(60 * 60_000);
  });

  it("ends one vault's grant, or every grant the card has", () => {
    const grants = createGrants({ now: () => 0 });
    grants.add({ card: "c1", thread: "Site", id: "github:o/r", label: "o/r" });
    grants.add({ card: "c1", thread: "Site", id: "github:o/other", label: "o/other" });
    grants.add({ card: "c2", thread: "Other", id: "github:o/r", label: "o/r" });
    const ended = grants.revoke("c1", "github:o/r");
    expect(ended).toHaveLength(1);
    expect(ended[0]!.id).toBe("github:o/r");
    expect(grants.allows("c1", "github:o/r")).toBe(false);
    expect(grants.allows("c1", "github:o/other")).toBe(true);
    const all = grants.revoke("c1");
    expect(all.map((g: { id: string }) => g.id)).toEqual(["github:o/other"]);
    expect(grants.list()).toHaveLength(1);
    expect(grants.revoke("nobody")).toEqual([]);
  });

  it("drops an expired grant from the list", () => {
    let t = 0;
    const grants = createGrants({ now: () => t, ms: 1000 });
    grants.add({ card: "c1", thread: "Site", id: "github:o/r", label: "o/r" });
    expect(grants.list()).toHaveLength(1);
    t = 1001;
    expect(grants.list()).toEqual([]);
  });

  // A grant that names a site covers that site and no other: a card with one could otherwise type a
  // secret into any page it opened, including one it controls (2026-10-28).
  it("covers only the site it names", () => {
    const grants = createGrants({ now: () => 0 });
    grants.add({ card: "c1", thread: "Site", id: "github:o/r", label: "o/r", site: "dashboard.stripe.com" });
    expect(grants.allows("c1", "github:o/r", "dashboard.stripe.com")).toBe(true);
    expect(grants.allows("c1", "github:o/r", "evil.example.com")).toBe(false);
    expect(grants.allows("c1", "github:o/r")).toBe(true);
  });

  // A grant with no site says nothing about where a value may be typed, so it covers only the
  // site-less powers: a command run and a dev server (2026-10-28).
  it("never lets a site-less grant cover a fill", () => {
    const grants = createGrants({ now: () => 0 });
    grants.add({ card: "c1", thread: "Site", id: "github:o/r", label: "o/r" });
    expect(grants.allows("c1", "github:o/r", "dashboard.stripe.com")).toBe(false);
    expect(grants.allows("c1", "github:o/r")).toBe(true);
  });

  it("keeps a grant for each site of the same vault", () => {
    const grants = createGrants({ now: () => 0 });
    grants.add({ card: "c1", id: "github:o/r", label: "o/r", site: "a.example.com" });
    grants.add({ card: "c1", id: "github:o/r", label: "o/r", site: "b.example.com" });
    expect(grants.list()).toHaveLength(2);
    expect(grants.allows("c1", "github:o/r", "a.example.com")).toBe(true);
    expect(grants.allows("c1", "github:o/r", "b.example.com")).toBe(true);
    expect(grants.allows("c1", "github:o/r", "c.example.com")).toBe(false);
  });
});

describe("grantMethods", () => {
  it("asks with the thread, the vault, the hour and the reason", async () => {
    const { grant, prompt, asked } = make();
    await grant("/repo", { card: "c1", thread: "Email forwarding", why: "Send a test email" });
    expect(prompt).toHaveBeenCalledTimes(1);
    const reason = asked[0]!;
    expect(reason).toContain('"Email forwarding"');
    expect(reason).toContain("o/r");
    expect(reason).toContain("1 hour");
    expect(reason).toContain("Send a test email");
  });

  it("says a thread when there's no title, and names the minutes when the grant isn't an hour", async () => {
    const { grant, asked } = make({ ms: 30 * 60_000 });
    await grant("/repo", { card: "c1" });
    const reason = asked[0]!;
    expect(reason).toContain("a thread");
    expect(reason).toContain("30 minutes");
    expect(reason).not.toContain("(");
  });

  it("names more than one hour in hours", async () => {
    const { grant, asked } = make({ ms: 2 * 60 * 60_000 });
    await grant("/repo", { card: "c1", thread: "Site" });
    expect(asked[0]!).toContain("2 hours");
  });

  it("adds the grant and logs it when the answer is yes", async () => {
    const { grant, grants, log } = make();
    const result = await grant("/repo", { card: "c1", thread: "Email forwarding" });
    expect(result.granted).toBe(true);
    expect(result.label).toBe("o/r");
    expect(result.until).toBe(1000 + GRANT_MS);
    expect(grants.allows("c1", "github:o/r")).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({ action: "grant", by: "thread", card: "c1", thread: "Email forwarding", vault: "o/r", detail: undefined });
  });

  it("denies the grant and logs the denial when the answer is no", async () => {
    const { grant, grants, log } = make({ allow: false });
    const result = await grant("/repo", { card: "c1", thread: "Email forwarding" });
    expect(result).toEqual({ denied: true, label: "o/r" });
    expect(grants.allows("c1", "github:o/r")).toBe(false);
    expect(log).toHaveBeenCalledWith({ action: "grant", by: "thread", card: "c1", thread: "Email forwarding", vault: "o/r", detail: undefined, outcome: "denied" });
  });

  it("needs the card the grant is for", async () => {
    const { grant, prompt, log } = make();
    await expect(grant("/repo", { card: "", thread: "Site" })).rejects.toThrow(/needs the card/);
    expect(prompt).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("says whether the card may use the vault without asking", () => {
    const { methods, grants } = make();
    expect(methods.granted("c1", "github:o/r")).toBe(false);
    grants.add({ card: "c1", thread: "Site", id: "github:o/r", label: "o/r" });
    expect(methods.granted("c1", "github:o/r")).toBe(true);
  });

  it("lists the grants the drawer shows", () => {
    const { methods, grants } = make();
    grants.add({ card: "c1", thread: "Site", id: "github:o/r", label: "o/r" });
    expect(methods.grantList()).toEqual([{ card: "c1", thread: "Site", id: "github:o/r", label: "o/r", at: 1000, until: 1000 + GRANT_MS }]);
  });

  it("logs one line for each grant it ends", () => {
    const { methods, grants, log } = make();
    grants.add({ card: "c1", thread: "Site", id: "github:o/r", label: "o/r" });
    grants.add({ card: "c1", thread: "Site", id: "github:o/other", label: "o/other" });
    expect(methods.revoke("c1")).toEqual({ revoked: 2 });
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenNthCalledWith(1, { action: "revoke", by: "you", card: "c1", thread: "Site", vault: "o/r" });
    expect(log).toHaveBeenNthCalledWith(2, { action: "revoke", by: "you", card: "c1", thread: "Site", vault: "o/other" });
    expect(grants.list()).toEqual([]);
  });
});
