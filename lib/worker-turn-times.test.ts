// When each turn on a worker card ended (lib/worker-turn-times.ts), over a fake account client: the result rows of the
// cards asked for, in chunks and pages, up to a cap, and nothing when signed out or a read fails.
import { describe, expect, it, vi } from "vitest";

vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));
const syncOrgId = vi.fn<(client: unknown, uid: string) => Promise<string | null>>(() => Promise.resolve("org-1"));
vi.mock("./cloud-sync", () => ({ syncOrgId: (client: unknown, uid: string) => syncOrgId(client, uid) }));

const { TURN_CARDS, TURN_PAGE, TURN_ROWS_MAX, workerTurnTimes } = await import("./worker-turn-times");

type Row = { card_id: string; at: string };

// A client whose cloud_thread_items reads answer `pages` in turn (or an error), recording the filters and ranges.
function client(pages: (Row[] | "error")[], uid: string | null = "u1") {
  const calls: { in: unknown[]; eq: unknown[][]; range: number[] }[] = [];
  let read = 0;
  const from = vi.fn(() => {
    const call = { in: [] as unknown[], eq: [] as unknown[][], range: [] as number[] };
    calls.push(call);
    const query = {
      select: () => query,
      eq: (...args: unknown[]) => (call.eq.push(args), query),
      in: (_col: string, ids: unknown[]) => ((call.in = ids), query),
      order: () => query,
      range: (a: number, b: number) => {
        call.range = [a, b];
        const page = pages[read++] ?? [];
        return Promise.resolve(page === "error" ? { data: null, error: { message: "boom" } } : { data: page, error: null });
      },
    };
    return query;
  });
  const c = { auth: { getSession: () => Promise.resolve({ data: { session: uid ? { user: { id: uid } } : null } }) }, from };
  return { client: c as never, calls, from };
}

const iso = (ms: number) => new Date(ms).toISOString();

describe("workerTurnTimes", () => {
  it("reads only the result rows of the cards asked for, oldest first per card", async () => {
    const { client: c, calls } = client([[{ card_id: "a", at: iso(1_000) }, { card_id: "a", at: iso(2_000) }, { card_id: "b", at: "not a time" }, { card_id: "b", at: iso(3_000) }]]);
    const times = await workerTurnTimes(["a", "b"], c);
    expect([...times]).toEqual([["a", [1_000, 2_000]], ["b", [3_000]]]);
    expect(calls[0]).toMatchObject({ in: ["a", "b"], eq: [["org_id", "org-1"], ["kind", "result"]], range: [0, TURN_PAGE - 1] });
  });

  it("walks cards in chunks and rows in pages", async () => {
    const ids = Array.from({ length: TURN_CARDS + 1 }, (_, i) => `c${i}`);
    const full = Array.from({ length: TURN_PAGE }, () => ({ card_id: "c0", at: iso(1) }));
    const { client: c, calls } = client([full, [], [{ card_id: `c${TURN_CARDS}`, at: iso(5) }]]);
    const times = await workerTurnTimes(ids, c);
    expect(calls.map((x) => [x.in.length, x.range[0]])).toEqual([[TURN_CARDS, 0], [TURN_CARDS, TURN_PAGE], [1, 0]]);
    expect(times.get("c0")).toHaveLength(TURN_PAGE);
    expect(times.get(`c${TURN_CARDS}`)).toEqual([5]);
  });

  it("stops at the cap", async () => {
    const full = Array.from({ length: TURN_PAGE }, () => ({ card_id: "a", at: iso(1) }));
    const { client: c, from } = client(Array.from({ length: TURN_ROWS_MAX / TURN_PAGE + 5 }, () => full));
    await workerTurnTimes(["a"], c);
    expect(from).toHaveBeenCalledTimes(TURN_ROWS_MAX / TURN_PAGE);
  });

  it("keeps the chunks before a failed read and drops the one it failed in", async () => {
    const ids = Array.from({ length: TURN_CARDS + 1 }, (_, i) => `c${i}`);
    // The second chunk's first page is full, so a second is read, and that one fails.
    const full = Array.from({ length: TURN_PAGE }, () => ({ card_id: `c${TURN_CARDS}`, at: iso(2) }));
    const again = client([[{ card_id: "c0", at: iso(1) }], full, "error"]);
    expect([...(await workerTurnTimes(ids, again.client))]).toEqual([["c0", [1]]]);
  });

  it("is empty with no cards, signed out, or no workspace", async () => {
    const none = client([]);
    expect((await workerTurnTimes([], none.client)).size).toBe(0);
    expect(none.from).not.toHaveBeenCalled();
    expect((await workerTurnTimes(["a"], client([], null).client)).size).toBe(0);
    syncOrgId.mockResolvedValueOnce(null);
    expect((await workerTurnTimes(["a"], client([]).client)).size).toBe(0);
  });
});
