import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoShareResult } from "./vault-shared";

const view = vi.hoisted(() => ({ vaultBridge: vi.fn() }));
vi.mock("./vault-view", () => view);

const { linkNote, shareLinkedRepo } = await import("./team-vault-link");

beforeEach(() => view.vaultBridge.mockReset());

describe("shareLinkedRepo", () => {
  it("is null with no vault bridge (the browser)", async () => {
    view.vaultBridge.mockReturnValue(null);
    expect(await shareLinkedRepo("o1", "Acme", "a/b")).toBeNull();
  });

  it("is null in an older shell with no shareRepo", async () => {
    view.vaultBridge.mockReturnValue({});
    expect(await shareLinkedRepo("o1", "Acme", "a/b")).toBeNull();
  });

  it("asks main to share the repo's vault with the team", async () => {
    const shareRepo = vi.fn(() => Promise.resolve({ secrets: 3 }));
    view.vaultBridge.mockReturnValue({ shareRepo });
    expect(await shareLinkedRepo("o1", "Acme", "a/b")).toEqual({ secrets: 3 });
    expect(shareRepo).toHaveBeenCalledWith("o1", "Acme", "a/b");
  });

  it("turns a failure into an error, from an Error or a string", async () => {
    view.vaultBridge.mockReturnValue({ shareRepo: () => Promise.reject(new Error("locked")) });
    expect(await shareLinkedRepo("o1", "Acme", "a/b")).toEqual({ error: "locked" });
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a bridge can reject with a bare string
    view.vaultBridge.mockReturnValue({ shareRepo: () => Promise.reject("nope") });
    expect(await shareLinkedRepo("o1", "Acme", "a/b")).toEqual({ error: "nope" });
  });
});

describe("linkNote", () => {
  const note = (vault: RepoShareResult | { error: string } | null) => linkNote("a/b", "Acme", vault);

  it("says a teammate on a Mac shares the secrets when there was no vault to ask", () => {
    expect(note(null)).toBe("Linked a/b. Its 🔐 secrets go to Acme when someone on the team shares them from a Mac.");
  });

  it("says why the secrets weren't shared", () => {
    expect(note({ error: "locked" })).toBe("Linked a/b. Its 🔐 secrets weren't shared: locked");
  });

  it("says the secrets stayed here when Touch ID was cancelled", () => {
    expect(note({ denied: true })).toBe("Linked a/b. Its 🔐 secrets stay on this Mac for now: share them from the 🔐 drawer.");
  });

  it("explains each skip", () => {
    expect(note({ skipped: "none" })).toBe("Linked a/b. No 🔐 secrets for it on this Mac yet: once you add some, Share… in the 🔐 drawer offers Acme.");
    expect(note({ skipped: "shared" })).toBe("Linked a/b. Its 🔐 secrets are already shared.");
    expect(note({ skipped: "exists" })).toBe("Linked a/b. Acme already has its 🔐 secrets; this Mac asks to join them by itself.");
  });

  it("counts the shared secrets, singular and plural", () => {
    expect(note({ secrets: 1 })).toBe("Linked a/b. 1 🔐 secret shared with Acme; teammates' Macs you approve once get them.");
    expect(note({ secrets: 4, keptLocal: [] })).toBe("Linked a/b. 4 🔐 secrets shared with Acme; teammates' Macs you approve once get them.");
    expect(note({})).toBe("Linked a/b. 0 🔐 secrets shared with Acme; teammates' Macs you approve once get them.");
  });

  it("names the secrets that stayed on this Mac", () => {
    expect(note({ secrets: 2, keptLocal: ["api_key", "token"] })).toBe(
      "Linked a/b. 2 🔐 secrets shared with Acme; teammates' Macs you approve once get them. api_key, token stayed on this Mac (the team vault takes upper-case names).",
    );
  });
});
