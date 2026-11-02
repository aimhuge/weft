// weft.zip's one host for every card (lib/web-host.ts): its verbs go through the cloud acts, it has no Mac features
// but Send later, and its menu is a remote host's.
import { describe, expect, it, vi } from "vitest";
import { remoteMenu } from "./card-menu-remote";
import type { ThreadTransport } from "./thread-transport";
import { webHost } from "./web-host";

describe("webHost", () => {
  it("sends a verb as the card's host row and answers what it came to", async () => {
    const act = vi.fn(() => Promise.resolve(undefined));
    const host = webHost({ act }, { desktop: false } as ThreadTransport, () => Promise.resolve(""));
    await expect(host.act("card.update", { id: "c1", body: { starred: true } })).resolves.toBeUndefined();
    expect(act).toHaveBeenCalledWith("card.update", "c1", { body: { starred: true } });
    expect(host.kind).toBe("cloud");
    expect(host.menu).toBe(remoteMenu);
  });

  it("offers Send later and none of a Mac's own features", () => {
    const host = webHost({ act: vi.fn() }, { desktop: false } as ThreadTransport, () => Promise.resolve(""));
    expect(host.can("schedule")).toBe(true);
    for (const feature of ["files", "pane", "delete", "share", "folder", "dev", "vault", "login"] as const) expect(host.can(feature)).toBe(false);
    // No session line in a browser tab, so warming a card is a no-op rather than a host row.
    host.warm("c1");
  });

  it("has no reads or editor of its own: each says so instead of reaching a Mac's routes", async () => {
    const host = webHost({ act: vi.fn() }, { desktop: false } as ThreadTransport, () => Promise.resolve(""));
    expect(host.can("reads")).toBe(false);
    await expect(host.read("pile", "/p")).rejects.toThrow(/weft.zip/);
    await expect(host.files.list("c1")).rejects.toThrow(/weft.zip/);
    await expect(host.files.write("c1", "a.ts", "x")).rejects.toThrow(/weft.zip/);
    expect(host.files.live).toBe(false);
  });
});
