import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pending, Session } from "./runner-state";
import type { Card } from "./types";

const sessions = new Map<string, Session>();
const settle = vi.fn();
const cards = new Map<string, Card>();

vi.mock("./runner-pending", () => ({ settle }));
vi.mock("./runner-state", () => ({ sessions }));
vi.mock("./store", () => ({ getCard: (id: string) => cards.get(id) }));

const { releaseOnWrite, writeMessage } = await import("./blocking");

const holder = { id: "b", title: "Restyle", claim: "/repo/Login.tsx#Form" };

function pending(over: Partial<Pending> = {}): Pending {
  return { id: "p1", index: 0, toolName: "Edit", title: "t", input: {}, why: { category: "same-code", detail: "d", holder }, waiting: true, resolve: vi.fn(), ...over };
}

beforeEach(() => {
  sessions.clear();
  cards.clear();
  vi.clearAllMocks();
});

describe("releaseOnWrite", () => {
  it("releases the card waiting on the file the holder just wrote", () => {
    cards.set("b", { id: "b", title: "Restyle" } as Card);
    sessions.set("a", { pending: [pending()] } as unknown as Session);
    releaseOnWrite("b", "/repo/Login.tsx");
    expect(settle).toHaveBeenCalledWith("a", false, undefined, "p1", undefined, writeMessage("Restyle", "/repo/Login.tsx"));
  });

  it("leaves a card waiting on another file alone", () => {
    cards.set("b", { id: "b", title: "Restyle" } as Card);
    sessions.set("a", { pending: [pending()] } as unknown as Session);
    releaseOnWrite("b", "/repo/Other.tsx");
    expect(settle).not.toHaveBeenCalled();
  });

  it("leaves a card waiting on a different holder alone", () => {
    // Another card waits on the same file, but its holder is not the one that wrote.
    const other = { id: "c", title: "Other", claim: "/repo/Login.tsx#Form" };
    sessions.set("a", { pending: [pending({ why: { category: "same-code", detail: "d", holder: other } })] } as unknown as Session);
    releaseOnWrite("b", "/repo/Login.tsx");
    expect(settle).not.toHaveBeenCalled();
  });
});

describe("writeMessage", () => {
  it("names the holder and the file, and tells the thread to redo its edit on top", () => {
    expect(writeMessage("Restyle", "/repo/Login.tsx")).toMatch(/‘Restyle’ has now written Login\.tsx/);
    expect(writeMessage("Restyle", "/repo/Login.tsx")).toMatch(/Re-read Login\.tsx and redo this edit on top/);
  });
});
