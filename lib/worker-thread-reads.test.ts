// A worker card's whole-thread find and its pictures' URLs (lib/worker-thread-reads.ts), over a fake account client:
// rows read in pages and matched by seq, sealed rows matching nothing, and blob refs signed for the account's workspace.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));
const syncOrgId = vi.fn<(client: unknown, uid: string) => Promise<string | null>>();
vi.mock("./cloud-sync", () => ({ syncOrgId: (client: unknown, uid: string) => syncOrgId(client, uid) }));
const resolveBlobUrls = vi.fn((_client: unknown, _org: string, refs: readonly string[]) => Promise.resolve(Object.fromEntries(refs.map((r) => [r, `https://sb.test/${r.slice(-4)}`]))));
vi.mock("./blob-urls", () => ({ resolveBlobUrls: (client: unknown, org: string, refs: readonly string[]) => resolveBlobUrls(client, org, refs) }));

// Main's keys over the control server (lib/worker-board-open.ts macRing): none unless a test hands some in.
const shell = vi.fn<(route: string, body: unknown) => Promise<unknown>>(() => Promise.reject(new Error("no desktop shell")));
vi.mock("./browser-shell", () => ({ shell: (route: string, body: unknown) => shell(route, body) }));
const readBlob = vi.fn<(client: unknown, org: string, sha: string) => Promise<{ bytes: ArrayBuffer; type: string } | null>>(() => Promise.resolve(null));
vi.mock("./blob-read", async (orig) => ({ ...(await orig<object>()), readBlob: (client: unknown, org: string, sha: string) => readBlob(client, org, sha) }));

const { BLOB_REFS_MAX, SEARCH_MAX, SEARCH_PAGE, workerBlobUrls, workerThreadSearch } = await import("./worker-thread-reads");
const { forgetMacRing } = await import("./worker-board-open");
const { sodium } = await import("./sodium");
const { sealJson, aadFor, blobAad, sealBytes } = await import("./sync-seal");
const KEY = { version: 1, key: Buffer.alloc(32, 7).toString("base64") };

type Row = { seq: number; item: unknown } | { tool_id: string; result: string };

// A client whose cloud_thread_items read answers `pages` in turn (or an error), recording each range asked for.
function client(pages: (Row[] | "error")[], uid: string | null = "u1") {
  const ranges: [number, number][] = [];
  const filters: unknown[][] = [];
  const tables: string[] = [];
  let read = 0;
  const query = {
    select: () => query,
    eq: (...args: unknown[]) => {
      filters.push(args);
      return query;
    },
    order: () => query,
    range: (from: number, to: number) => {
      ranges.push([from, to]);
      const page = pages[read++] ?? [];
      return Promise.resolve(page === "error" ? { data: null, error: { message: "boom" } } : { data: page, error: null });
    },
  };
  const c = {
    auth: { getSession: () => Promise.resolve({ data: { session: uid ? { user: { id: uid } } : null } }) },
    from: (table: string) => {
      tables.push(table);
      return query;
    },
  };
  return { client: c as never, ranges, filters, tables };
}

const user = (text: string) => ({ kind: "user", text, at: 0 });
const say = (text: string) => ({ kind: "assistant", text, at: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  forgetMacRing();
  syncOrgId.mockResolvedValue("org-1");
});

describe("workerThreadSearch", () => {
  it("finds the query over every row of the card's thread, by seq", async () => {
    const { client: c, filters } = client([[{ seq: 0, item: user("deploy it") }, { seq: 1, item: say("Deployed. Deploy again?") }, { seq: 4, item: say("nothing") }]]);
    expect(await workerThreadSearch("c1", "deploy", c)).toEqual([{ index: 0, hits: 1 }, { index: 1, hits: 2 }]);
    expect(filters).toEqual([["org_id", "org-1"], ["card_id", "c1"]]);
  });

  it("reads page after page until one comes back short", async () => {
    const full = Array.from({ length: SEARCH_PAGE }, (_, i) => ({ seq: i, item: say(i === 7 ? "needle" : "hay") }));
    const { client: c, ranges } = client([full, [{ seq: SEARCH_PAGE, item: say("another needle") }]]);
    expect(await workerThreadSearch("c1", "needle", c)).toEqual([{ index: 7, hits: 1 }, { index: SEARCH_PAGE, hits: 1 }]);
    expect(ranges).toEqual([[0, SEARCH_PAGE - 1], [SEARCH_PAGE, 2 * SEARCH_PAGE - 1]]);
  });

  it("stops at SEARCH_MAX items", async () => {
    const full = Array.from({ length: SEARCH_PAGE }, (_, i) => ({ seq: i, item: say("hay") }));
    const { client: c, ranges } = client(Array.from({ length: SEARCH_MAX / SEARCH_PAGE + 2 }, () => full));
    await workerThreadSearch("c1", "x", c);
    expect(ranges).toHaveLength(SEARCH_MAX / SEARCH_PAGE);
  });

  it("matches nothing in a sealed row or one that isn't an item", async () => {
    const sealed = { $sealed: 1, v: 1, n: "n", c: "deploy" };
    const { client: c } = client([[{ seq: 0, item: sealed }, { seq: 1, item: null }, { seq: 2, item: "deploy" }, { seq: 3, item: say("deploy") }]]);
    expect(await workerThreadSearch("c1", "deploy", c)).toEqual([{ index: 3, hits: 1 }]);
  });

  it("searches a long tool result cut out of its item, and lands on that item's index", async () => {
    const cut = (id: string) => ({ kind: "tool", id, name: "Bash", summary: "ls", resultBytes: 9000, at: 0 });
    const items = [{ seq: 0, item: say("hay") }, { seq: 1, item: cut("t1") }, { seq: 2, item: cut("t2") }, { seq: 3, item: cut("t3") }];
    const outputs = [{ tool_id: "t1", result: "a needle and a needle" }, { tool_id: "t2", result: '{"$sealed":1,"c":"needle"}' }, { tool_id: "gone", result: "needle" }];
    const { client: c, tables } = client([items, outputs]);
    expect(await workerThreadSearch("c1", "needle", c)).toEqual([{ index: 1, hits: 2 }]);
    expect(tables).toEqual(["cloud_thread_items", "cloud_tool_outputs"]);
  });

  it("pages the cut results until one comes back short, and is null when they can't be read", async () => {
    const items = [{ seq: 0, item: { kind: "tool", id: "t9", name: "Bash", resultBytes: 9000, at: 0 } }];
    const full = Array.from({ length: SEARCH_PAGE }, (_, i) => ({ tool_id: `x${i}`, result: "hay" }));
    const { client: c, ranges } = client([items, full, [{ tool_id: "t9", result: "needle" }]]);
    expect(await workerThreadSearch("c1", "needle", c)).toEqual([{ index: 0, hits: 1 }]);
    expect(ranges).toHaveLength(3);
    expect(await workerThreadSearch("c1", "needle", client([items, "error"]).client)).toBeNull();
  });

  it("reads no outputs when no item was cut", async () => {
    const { client: c, tables } = client([[{ seq: 0, item: { kind: "tool", id: "t1", name: "Bash", result: "short needle", at: 0 } }]]);
    expect(await workerThreadSearch("c1", "needle", c)).toEqual([{ index: 0, hits: 1 }]);
    expect(tables).toEqual(["cloud_thread_items"]);
  });

  it("is empty for an empty query, without a read", async () => {
    const { client: c, ranges } = client([]);
    expect(await workerThreadSearch("c1", "", c)).toEqual([]);
    expect(ranges).toEqual([]);
  });

  it("is null when the rows can't be read, or no one is signed in", async () => {
    expect(await workerThreadSearch("c1", "x", client(["error"]).client)).toBeNull();
    expect(await workerThreadSearch("c1", "x", client([], null).client)).toBeNull();
    syncOrgId.mockResolvedValueOnce(null);
    expect(await workerThreadSearch("c1", "x", client([]).client)).toBeNull();
  });
});

describe("a worker's sealed thread", () => {
  it("opens sealed rows and cut results with main's keys before matching; one it can't open matches nothing", async () => {
    const s = await sodium();
    shell.mockResolvedValue({ keys: [KEY] });
    const sealed = (seq: number, item: unknown) => ({ seq, item: sealJson(s, item, KEY, aadFor("org-1", "c1", `item:${seq}`)) });
    const cut = { kind: "tool", id: "t1", name: "Bash", summary: "ls", resultBytes: 9000, at: 0 };
    const other = { seq: 2, item: sealJson(s, say("needle"), { version: 9, key: KEY.key }, aadFor("org-1", "c1", "item:2")) };
    const outputs = [{ tool_id: "t1", result: JSON.stringify(sealJson(s, "a needle", KEY, aadFor("org-1", "c1", "tool:t1"))) }];
    const { client: c } = client([[sealed(0, say("one needle")), sealed(1, cut), other], outputs]);
    expect(await workerThreadSearch("c1", "needle", c)).toEqual([{ index: 0, hits: 1 }, { index: 1, hits: 1 }]);
    expect(shell).toHaveBeenCalledWith("/sync/keyring", { orgId: "org-1" });
    // A row that isn't an item at all reads as a hole.
    expect(await workerThreadSearch("c1", "needle", client([[{ seq: 0, item: null }]]).client)).toEqual([]);
    // Sealed for a version main doesn't hold: the 🔒 stand-in, which no search for "Sealed" finds either.
    expect(await workerThreadSearch("c1", "Sealed", client([[other]]).client)).toEqual([]);
  });

  it("opens a sealed picture into a data: URL, keeps a plain one signed, and reads each once", async () => {
    const s = await sodium();
    shell.mockResolvedValue({ keys: [KEY] });
    const bytes = new TextEncoder().encode("png bytes");
    const sha = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
    const plainSha = "c".repeat(64);
    const stored = sealBytes(s, bytes, KEY, blobAad("org-1", sha));
    readBlob.mockImplementation((_c, _o, h) => Promise.resolve(h === sha ? { bytes: stored.slice().buffer, type: "image/png" } : h === plainSha ? { bytes: new ArrayBuffer(3), type: "image/png" } : null));
    const refs = [`blob:sha256:${sha}`, `blob:sha256:${plainSha}`, `blob:sha256:${"d".repeat(64)}`];
    const urls = await workerBlobUrls(refs, client([]).client);
    expect(urls[refs[0]!]).toBe(`data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
    expect(urls[refs[1]!]).toBe("https://sb.test/cccc");
    expect(urls[refs[2]!]).toBe("https://sb.test/dddd");
    await workerBlobUrls(refs, client([]).client);
    expect(readBlob.mock.calls.filter(([, , h]) => h === sha)).toHaveLength(1);
  });
});

describe("workerBlobUrls", () => {
  const ref = (c: string) => `blob:sha256:${c.repeat(64)}`;

  it("signs the blob refs asked for in the account's workspace, once each, and nothing else", async () => {
    const urls = await workerBlobUrls([ref("a"), ref("a"), "nope", ref("b")], client([]).client);
    expect(urls).toEqual({ [ref("a")]: "https://sb.test/aaaa", [ref("b")]: "https://sb.test/bbbb" });
    expect(resolveBlobUrls).toHaveBeenCalledWith(expect.anything(), "org-1", [ref("a"), ref("b")]);
  });

  it("signs at most BLOB_REFS_MAX refs a read", async () => {
    const many = Array.from({ length: BLOB_REFS_MAX + 5 }, (_, i) => `blob:sha256:${i.toString(16).padStart(64, "0")}`);
    await workerBlobUrls(many, client([]).client);
    expect(resolveBlobUrls.mock.calls[0]![2]).toHaveLength(BLOB_REFS_MAX);
  });

  it("is empty with no refs, or signed out", async () => {
    expect(await workerBlobUrls(["nope"], client([]).client)).toEqual({});
    expect(await workerBlobUrls([ref("a")], client([], null).client)).toEqual({});
    expect(resolveBlobUrls).not.toHaveBeenCalled();
  });
});
