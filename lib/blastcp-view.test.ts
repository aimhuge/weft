import { afterEach, describe, expect, it, vi } from "vitest";
import { blastcpBridge, blastcpTitle, createProperty, newPropertyName, needsRestart, restartWeft, countsLine, expiryNote, platformName, propertyOptions, queueOf, shownFolders, untilText, weftConnectNote, type BlastcpBridge, type BlastcpFolder, type BlastcpPost, type BlastcpStatus } from "./blastcp-view";

const NOW = Date.UTC(2026, 9, 12, 12);
const H = 3_600_000;

const post = (over: Partial<BlastcpPost>): BlastcpPost => ({ id: "p", platform: "linkedin", status: "draft", title: "Hi", scheduledFor: null, publishedAt: null, url: null, reviewUrl: null, ...over });
const folder = (path: string, over: Partial<BlastcpFolder> = {}): BlastcpFolder => ({ folder: path, link: null, posts: null, error: null, ...over });
const link = (name: string) => ({ org: "acme", property: name.toLowerCase(), name, url: "https://blastcp.com/acme/property/x" });

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("blastcpBridge", () => {
  it("is null outside the desktop shell and the bridge inside it", () => {
    expect(blastcpBridge()).toBeNull();
    const bridge = { status: () => null };
    (globalThis as { window?: unknown }).window = { weft: { blastcp: bridge } };
    expect(blastcpBridge()).toBe(bridge);
    (globalThis as { window?: unknown }).window = {};
    expect(blastcpBridge()).toBeNull();
  });
});

describe("needsRestart and restartWeft", () => {
  it("spots a main that hasn't loaded BlastCP yet", () => {
    expect(needsRestart("Error invoking remote method 'blastcp:status': Error: No handler registered for 'blastcp:status'")).toBe(true);
    expect(needsRestart("BlastCP is down")).toBe(false);
    expect(needsRestart(null)).toBe(false);
  });

  it("asks main to relaunch, then quits if it's still here", () => {
    vi.useFakeTimers();
    expect(restartWeft()).toBe(false);
    (globalThis as { window?: unknown }).window = { weft: {} };
    expect(restartWeft()).toBe(false);
    const splashAction = vi.fn();
    (globalThis as { window?: unknown }).window = { weft: { splashAction } };
    expect(restartWeft(100)).toBe(true);
    expect(splashAction).toHaveBeenLastCalledWith("relaunch");
    vi.advanceTimersByTime(100);
    expect(splashAction).toHaveBeenLastCalledWith("quit");
    (globalThis as { window?: { weft?: object } }).window = {};
    vi.useRealTimers();
  });
});

describe("queueOf", () => {
  it("lists what goes out next, soonest first, counts what waits on you and finds the last one out", () => {
    const posts = [
      post({ id: "later", status: "scheduled", scheduledFor: NOW + 5 * H }),
      post({ id: "soon", status: "publishing", scheduledFor: NOW - H }),
      post({ id: "loose", status: "scheduled", scheduledFor: null }),
      post({ id: "d1" }),
      post({ id: "d2" }),
      post({ id: "a", status: "awaiting_human" }),
      post({ id: "f", status: "failed" }),
      post({ id: "old", status: "published", publishedAt: NOW - 9 * H }),
      post({ id: "new", status: "published", publishedAt: NOW - H }),
      post({ id: "undated", status: "published" }),
    ];
    const q = queueOf(posts, NOW);
    expect(q.next.map((p) => p.id)).toEqual(["soon", "later"]);
    expect(q).toMatchObject({ drafts: 2, waiting: 1, failed: 1, overdue: 1 });
    expect(q.last?.id).toBe("new");
    expect(queueOf([], NOW)).toMatchObject({ next: [], last: null, overdue: 0 });
  });
});

describe("untilText", () => {
  it("reads minutes, hours, then days, and now once due", () => {
    expect(untilText(NOW - 1000, NOW)).toBe("now");
    expect(untilText(NOW + 40 * 60_000, NOW)).toBe("in 40m");
    expect(untilText(NOW + 5 * H, NOW)).toBe("in 5h");
    expect(untilText(NOW + 72 * H, NOW)).toBe("in 3d");
  });
});

describe("platformName", () => {
  it("names known platforms and capitalizes the rest", () => {
    expect(platformName("linkedin")).toBe("LinkedIn");
    expect(platformName("mastodon")).toBe("Mastodon");
    expect(platformName("")).toBe("Post");
  });
});

describe("countsLine", () => {
  it("joins what there is and is empty when there's nothing", () => {
    expect(countsLine({ drafts: 1, waiting: 2, failed: 3 })).toBe("1 draft · 2 to approve · 3 failed");
    expect(countsLine({ drafts: 2, waiting: 0, failed: 0 })).toBe("2 drafts");
    expect(countsLine({ drafts: 0, waiting: 0, failed: 0 })).toBe("");
  });
});

describe("expiryNote", () => {
  it("speaks up only in the last week", () => {
    expect(expiryNote(null, NOW)).toBeNull();
    expect(expiryNote(NOW + 20 * 24 * H, NOW)).toBeNull();
    expect(expiryNote(NOW + 3 * 24 * H, NOW)).toBe("Sign-in runs out in 3 days");
    expect(expiryNote(NOW + 2 * H, NOW)).toBe("Sign-in runs out in 1 day");
    expect(expiryNote(NOW - H, NOW)).toBe("Sign-in ran out");
  });
});

describe("propertyOptions", () => {
  const workspaces = [
    { slug: "acme", name: "Acme", properties: [{ slug: "blog", name: "Acme Blog" }, { slug: "weft", name: "Weft" }] },
    { slug: "me", name: "Me", properties: [{ slug: "weft-app", name: "Weft app" }] },
  ];

  it("puts the folder's best fits first", () => {
    expect(propertyOptions(workspaces, "/dev/weft").map((o) => [o.org, o.slug, o.score])).toEqual([
      ["acme", "weft", 2],
      ["me", "weft-app", 1],
      ["acme", "blog", 0],
    ]);
  });

  it("filters by name, slug or workspace, and scores nothing for a nameless folder", () => {
    expect(propertyOptions(workspaces, "/dev/weft", "blog").map((o) => o.slug)).toEqual(["blog"]);
    expect(propertyOptions(workspaces, "/dev/weft", " WEFT APP ").map((o) => o.slug)).toEqual(["weft-app"]);
    expect(propertyOptions(workspaces, "/").every((o) => o.score === 0)).toBe(true);
  });
});

describe("newPropertyName", () => {
  it("takes the search, else the folder's name in words", () => {
    expect(newPropertyName("/dev/weft", "  Weft Blog ")).toBe("Weft Blog");
    expect(newPropertyName("/dev/lisls-coloring_book")).toBe("Lisls Coloring Book");
    expect(newPropertyName("/dev/--")).toBe("");
  });
});

describe("createProperty", () => {
  const made = { linked: true as const, name: "Weft" };
  const bridgeWith = (create: unknown) => ({ createProperty: create }) as unknown as BlastcpBridge;

  it("creates and links through the bridge", async () => {
    const create = vi.fn(() => Promise.resolve(made));
    expect(await createProperty(bridgeWith(create), "/dev/weft", "alex", "Weft")).toBe(made);
    expect(create).toHaveBeenCalledWith("/dev/weft", "alex", "Weft");
  });

  it("asks for a restart when the window or main predates it, and passes other errors on", async () => {
    await expect(createProperty(bridgeWith(undefined), "/a", "o", "N")).rejects.toThrow("Restart Weft");
    await expect(createProperty(bridgeWith(() => Promise.reject(new Error("No handler registered for 'blastcp:create-property'"))), "/a", "o", "N")).rejects.toThrow("Restart Weft");
    await expect(createProperty(bridgeWith(() => Promise.reject(new Error("taken"))), "/a", "o", "N")).rejects.toThrow("taken");
  });
});

describe("shownFolders and blastcpTitle", () => {
  const status = (folders: BlastcpFolder[], signedIn = true): BlastcpStatus => ({ signedIn, user: null, expiresAt: null, error: null, folders });

  it("shows the top bar's project or all of them", () => {
    const all = [folder("/a"), folder("/b")];
    expect(shownFolders(all, "/b")).toEqual([all[1]]);
    expect(shownFolders(all, null)).toBe(all);
  });

  it("says what the rail icon would open", () => {
    expect(blastcpTitle(null, null)).toBe("BlastCP: connect your posting queue");
    expect(blastcpTitle(status([folder("/a")]), null)).toBe("BlastCP: no property linked yet");
    expect(blastcpTitle(status([folder("/a", { link: link("Weft") }), folder("/b", { link: link("Blog") })]), null)).toBe("BlastCP: Weft, Blog");
    expect(blastcpTitle(status([folder("/a", { link: link("Weft") }), folder("/b", { link: link("Blog") })]), "/b")).toBe("BlastCP: Blog");
  });
});

describe("weftConnectNote", () => {
  it("is null once connected, and says what to do otherwise", () => {
    expect(weftConnectNote({ state: "connected" })).toBeNull();
    expect(weftConnectNote({ state: "link", linkUrl: "https://blastcp.com/link/weft" })).toMatch(/already has a BlastCP account/);
    expect(weftConnectNote({ state: "signed-out" })).toMatch(/Sign in to your Weft account/);
    expect(weftConnectNote({ state: "off" })).toMatch(/disconnected/);
    expect(weftConnectNote({ state: "unavailable" })).toMatch(/can't take a Weft sign-in yet/);
  });
});
