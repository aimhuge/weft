// A worker card's whole-thread find and its pictures' URLs (lib/worker-thread-reads.ts), over a fake account client:
// rows read in pages and matched by seq, sealed rows matching nothing, and blob refs signed for the account's workspace.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));
const syncOrgId = vi.fn<(client: unknown, uid: string) => Promise<string | null>>();
vi.mock("./cloud-sync", () => ({ syncOrgId: (client: unknown, uid: string) => syncOrgId(client, uid) }));
const resolveBlobUrls = vi.fn((_client: unknown, _org: string, refs: readonly string[]) => Promise.resolve(Object.fromEntries(refs.map((r) => [r, `https://sb.test/${r.slice(-4)}`]))));
vi.mock("./blob-urls", () => ({ resolveBlobUrls: (client: unknown, org: string, refs: readonly string[]) => resolveBlobUrls(client, org, refs) }));

const { BLOB_REFS_MAX, SEARCH_MAX, SEARCH_PAGE, workerBlobUrls, workerThreadSearch } = await import("./worker-thread-reads");

type Row = { seq: number; item: unknown };

// A client whose cloud_thread_items read answers `pages` in turn (or an error), recording each range asked for.
function client(pages: (Row[] | "error")[], uid: string | null = "u1") {
  const ranges: [number, number][] = [];
  const filters: unknown[][] = [];
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
    from: () => query,
  };
  return { client: c as never, ranges, filters };
}

const user = (text: string) => ({ kind: "user", text, at: 0 });
const say = (text: string) => ({ kind: "assistant", text, at: 0 });

beforeEach(() => {
  vi.clearAllMocks();
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
