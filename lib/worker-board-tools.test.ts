import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";
import type { BoardRow } from "./worker-registry";

// The store is a fake: this worker's own cards.
const store = vi.hoisted(() => ({ cards: new Map<string, Card>() }));
vi.mock("./store", () => ({ DATA_DIR: "/tmp/weft-wbt-data", getCard: (id: string) => store.cards.get(id), listCards: () => [...store.cards.values()] }));

const { AGENT_REFUSED, CRON_ELSEWHERE, onWorkerBoard, workerCreateCard, workerListCards } = await import("./worker-board-tools");
const { setBoardLink } = await import("./worker-board-link");
const { MAC_CRON_REFUSED } = await import("./worker-mac-crons");

let root = "";
const rows: BoardRow[] = [];
const newCard = vi.fn<(target: string, folder: string, payload: Record<string, unknown>) => Promise<string>>(() => Promise.resolve("cmd-1"));
const own = (over: Partial<Card> = {}) => ({ id: "p1", title: "Parent", column: "running", cwd: path.join(root, "weft"), permissionMode: "acceptEdits", updatedAt: 9, ...over }) as Card;

function deps(parent?: string) {
  return {
    getCardId: () => parent,
    start: vi.fn(),
    create: vi.fn((args: { prompt: string; folder: string }) => ({ id: "new-1", title: args.prompt, cwd: args.folder, prompt: args.prompt }) as Card),
    defaultMode: () => "default" as const,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "wbt-"));
  fs.mkdirSync(path.join(root, "weft"));
  rows.length = 0;
  store.cards.clear();
  newCard.mockClear();
  setBoardLink({ workerId: "w1", root, cards: () => Promise.resolve(rows), newCard, setLists: () => Promise.resolve(null) });
});
afterEach(() => {
  setBoardLink(null);
  fs.rmSync(root, { recursive: true, force: true });
});

const macRow = (over: Partial<BoardRow> = {}): BoardRow => ({ card_id: "m1", folder: "/Users/me/app", owner_device: "mac-1", owner_worker: null, card: { id: "m1", title: "On the Mac", column: "review", updatedAt: 3 }, updated_at: "t", ...over });

describe("workerListCards", () => {
  it("lists this worker's cards and the Mac's together, newest first", async () => {
    store.cards.set("p1", own());
    rows.push(macRow());
    const text = await workerListCards({});
    expect(text.split("\n").map((l) => l.split(" | ")[0])).toEqual(["p1", "m1"]);
    expect(text).toContain("~/app");
  });
});

describe("workerCreateCard", () => {
  it("makes a card in this worker's own project here, in the parent's mode, and starts it", async () => {
    store.cards.set("p1", own());
    const d = deps("p1");
    expect(await workerCreateCard({ prompt: "Do it" }, d)).toBe("Created and started new-1: Do it");
    expect(d.create).toHaveBeenCalledWith(expect.objectContaining({ folder: path.join(root, "weft"), permissionMode: "acceptEdits", parentId: "p1" }));
    expect(d.start).toHaveBeenCalledWith("new-1", "Do it");
    expect(newCard).not.toHaveBeenCalled();
  });

  it("leaves a start=false card in Backlog, in the default mode with no parent", async () => {
    const d = deps();
    expect(await workerCreateCard({ prompt: "Later", folder: "weft", start: false }, d)).toBe("Created new-1 in Backlog: Later");
    expect(d.create).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: "default", parentId: undefined }));
    expect(d.start).not.toHaveBeenCalled();
  });

  it("sends a card for a Mac project as new_card, carrying title, tags and start=false", async () => {
    rows.push(macRow());
    const text = await workerCreateCard({ prompt: "Fix the Mac app", folder: "app", title: "Fix", tags: ["bug"], start: false, agent: "copywriter" }, deps());
    expect(newCard).toHaveBeenCalledWith("mac-1", "/Users/me/app", { prompt: "Fix the Mac app", title: "Fix", tags: ["bug"], start: false });
    expect(text).toMatch(/^Sent to your Mac for \/Users\/me\/app \(command cmd-1\)\. It lands in Backlog there, tagged from-worker, for the user to start/);
    expect(text).toMatch(/agent isn't carried/);
  });

  it("sends a card for another worker as run, started", async () => {
    const text = await workerCreateCard({ prompt: "Go", folder: "worker://w2/site" }, deps());
    expect(newCard).toHaveBeenCalledWith("worker:w2", "site", { prompt: "Go" });
    expect(text).toMatch(/It starts there once that worker takes it, in default mode/);
  });
});

describe("onWorkerBoard", () => {
  type Handler = (args: Record<string, unknown>, extra?: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
  const t = (name: string, handler: Handler) => ({ name, description: name, inputSchema: {}, handler }) as never;
  const original = vi.fn<Handler>(() => Promise.resolve({ content: [{ text: "ran" }] }));
  const swapped = () =>
    Object.fromEntries(
      onWorkerBoard([t("list_cards", original), t("create_card", original), t("create_agent", original), t("create_cron", original), t("list_crons", original), t("update_cron", original), t("delete_cron", original), t("run_cron_now", original), t("changelog_add", original)], deps()).map((x) => [
        (x as { name: string }).name,
        (x as unknown as { handler: Handler }).handler,
      ]),
    ) as Record<string, Handler>;

  beforeEach(() => original.mockClear());

  it("routes list_cards and create_card, refuses create_agent and keeps the changelog", async () => {
    const tools = swapped();
    rows.push(macRow());
    expect((await tools.list_cards!({})).content[0]?.text).toContain("m1");
    expect((await tools.create_card!({ prompt: "x", folder: "nowhere" })).isError).toBe(true);
    expect(await tools.create_agent!({})).toEqual({ content: [{ type: "text", text: AGENT_REFUSED }], isError: true });
    await tools.changelog_add!({});
    expect(original).toHaveBeenCalledTimes(1);
  });

  it("makes a cron only for this worker's projects, with the folder as its path here", async () => {
    const tools = swapped();
    store.cards.set("p1", own());
    expect((await tools.create_cron!({ prompt: "p", folder: "/Users/me/app" })).content[0]?.text).toBe(CRON_ELSEWHERE);
    expect((await tools.create_cron!({ prompt: "p", card_id: "m1" })).content[0]?.text).toMatch(/m1 isn't a card on this worker/);
    await tools.create_cron!({ prompt: "p", folder: "weft" });
    expect(original).toHaveBeenLastCalledWith({ prompt: "p", folder: path.join(root, "weft") }, undefined);
    await tools.create_cron!({ prompt: "p", card_id: "p1" });
    expect(original).toHaveBeenLastCalledWith({ prompt: "p", card_id: "p1" }, undefined);
  });

  it("answers a failure that isn't an Error as its text, and a card with no folder and no thread as unknown", async () => {
    newCard.mockRejectedValueOnce("offline");
    expect((await swapped().create_card!({ prompt: "x", folder: "worker://w2/site" })).content[0]?.text).toBe("offline");
    expect((await swapped().create_card!({ prompt: "x" })).content[0]?.text).toMatch(/^No project “”/);
  });

  it("says list_crons is this worker's, then lists the Mac's read-only", async () => {
    const out = await swapped().list_crons!({});
    expect(out.content.map((c) => c.text)).toEqual(["ran", expect.stringMatching(/this Weft Worker's crons/), expect.stringMatching(/can't read the Mac's crons yet/)]);
    const macCrons = () => Promise.resolve([{ device: "d1", label: "mbp", crons: [{ id: "k1", name: "Daily", expr: "0 9 * * *", mode: "fresh", enabled: true, folder: "app" }], updated_at: "t" }]);
    setBoardLink({ workerId: "w1", root, cards: () => Promise.resolve(rows), newCard, setLists: () => Promise.resolve(null), macCrons });
    expect((await swapped().list_crons!({})).content[2]?.text).toMatch(/^Crons on the user's Mac[^]*\nmac:k1 \| Daily \| every day at 9:00 \(0 9 \* \* \*\) \| fresh \| on \| no next run \| app on mbp$/);
  });

  it("refuses to change, delete or run a Mac's cron, and passes this worker's own through", async () => {
    const tools = swapped();
    for (const name of ["update_cron", "delete_cron", "run_cron_now"]) {
      expect(await tools[name]!({ id: "mac:k1" })).toEqual({ content: [{ type: "text", text: MAC_CRON_REFUSED }], isError: true });
      await tools[name]!({ id: "c1" });
    }
    expect(original).toHaveBeenCalledTimes(3);
  });
});
