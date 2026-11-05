import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ takeoversFrom: vi.fn(), noteTakeovers: vi.fn(), handoversFor: vi.fn(), noteAsks: vi.fn(), continueHandovers: vi.fn(), listCards: vi.fn() }));
vi.mock("./team-takeover-marks", () => ({ takeoversFrom: m.takeoversFrom, noteTakeovers: m.noteTakeovers }));
vi.mock("./handover", () => ({ handoversFor: m.handoversFor, noteAsks: m.noteAsks, continueHandovers: m.continueHandovers }));
vi.mock("./store", () => ({ listCards: m.listCards }));

import { applySide, handoverStates, NO_SIDE, readSide, sideUsers } from "./team-board-side";
import type { HandoverRow } from "./handover";

const ask = (over: Partial<HandoverRow> = {}): HandoverRow => ({ id: "h1", org_id: "org", card_id: "c1", by_user: "alex", owner_user: "zulker", status: "asked", branch: null, sha: null, note: null, created_at: "t", ...over });
const c = {} as never;

describe("readSide", () => {
  it("reads your taken cards, the asks on yours and your own asks together", async () => {
    m.takeoversFrom.mockResolvedValue(["t"]);
    m.handoversFor.mockImplementation((_c: unknown, side: string) => Promise.resolve([side]));
    expect(await readSide(c, "me", ["org"], 5)).toEqual({ taken: ["t"], asks: ["owner"], mine: ["asker"] });
    expect(m.handoversFor).toHaveBeenCalledWith(c, "owner", "me", ["org"], 5);
    expect(await readSide(c, "me", ["org"])).toEqual({ taken: ["t"], asks: ["owner"], mine: ["asker"] });
  });
});

describe("sideUsers", () => {
  it("names who took your cards and who asks for them", () => {
    expect(sideUsers({ taken: [{ org_id: "o", card_id: "c", by_user: "sam", at: "t" }], asks: [ask()], mine: [ask({ by_user: "me" })] })).toEqual(["sam", "alex"]);
    expect(sideUsers(NO_SIDE)).toEqual([]);
  });
});

describe("applySide", () => {
  it("notes takeovers and asks, and continues your pushed asks in the background", () => {
    const name = () => "Alex";
    const cont = vi.fn(() => Promise.resolve());
    applySide({ taken: [], asks: [ask()], mine: [ask({ by_user: "me" })] }, ["org"], name, c, cont);
    expect(m.noteTakeovers).toHaveBeenCalledWith([], name);
    expect(m.noteAsks).toHaveBeenCalledWith([ask()], ["org"], name, m.listCards);
    expect(cont).toHaveBeenCalledWith([ask({ by_user: "me" })], c);
    m.continueHandovers.mockResolvedValue(undefined);
    applySide(NO_SIDE, [], name, c);
    expect(m.continueHandovers).toHaveBeenCalledWith([], c);
  });
});

describe("handoverStates", () => {
  it("keeps your newest ask per card, with its branch and note when it has them", () => {
    const out = handoverStates([ask({ status: "pushed", branch: "b" }), ask({ id: "h0" }), ask({ id: "h2", card_id: "c2", status: "failed", note: "no access" })]);
    expect([...out]).toEqual([
      ["c1", { id: "h1", status: "pushed", branch: "b" }],
      ["c2", { id: "h2", status: "failed", note: "no access" }],
    ]);
  });
});
