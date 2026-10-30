import { describe, expect, it } from "vitest";
import { cardRow, commandRow } from "../components/web-board/web-board-harness";
import { applyCommandChange, boardCommands, canReply, cardReplies, commandLine, replyNote, webTargets } from "./web-commands";

describe("webTargets", () => {
  it("offers the folders of your own Macs, most recently active first", () => {
    const rows = [
      cardRow({ card_id: "a", folder: "/dev/old", updated_at: "2026-10-01T00:00:00Z" }),
      cardRow({ card_id: "b", folder: "/dev/new", updated_at: "2026-10-09T00:00:00Z" }),
      cardRow({ card_id: "c", folder: "/dev/new", updated_at: "2026-10-05T00:00:00Z" }),
    ];
    expect(webTargets(rows, "u1")).toEqual([
      { device: "mac-1", folder: "/dev/new", label: "new" },
      { device: "mac-1", folder: "/dev/old", label: "old" },
    ]);
  });

  it("keeps the order it was given for folders that are equally recent", () => {
    const rows = [cardRow({ card_id: "a", folder: "/dev/a" }), cardRow({ card_id: "b", folder: "/dev/b" })];
    expect(webTargets(rows, "u1").map((t) => t.label)).toEqual(["a", "b"]);
  });

  it("leaves out a teammate's folders, deleted cards, the copilot and an empty folder", () => {
    const rows = [
      cardRow({ card_id: "a", folder: "/dev/theirs", owner_user: "u2" }),
      cardRow({ card_id: "b", folder: "/dev/gone", deleted: true }),
      cardRow({ card_id: "c", folder: "/dev/copilot", card: { role: "copilot" } }),
      cardRow({ card_id: "d", folder: "" }),
      cardRow({ card_id: "e", folder: "/dev/mine" }),
    ];
    expect(webTargets(rows, "u1").map((t) => t.folder)).toEqual(["/dev/mine"]);
  });

  it("tells folders with the same name apart by their path", () => {
    const rows = [cardRow({ card_id: "a", folder: "/work/app" }), cardRow({ card_id: "b", folder: "/home/app", updated_at: "2026-10-01T00:00:00Z" })];
    expect(webTargets(rows, "u1").map((t) => t.label)).toEqual(["/work/app", "/home/app"]);
  });

  it("tells the same folder on two Macs apart by which Mac", () => {
    const rows = [
      cardRow({ card_id: "a", folder: "/dev/app", owner_device: "mac-1" }),
      cardRow({ card_id: "b", folder: "/dev/app", owner_device: "mac-2", updated_at: "2026-10-01T00:00:00Z" }),
    ];
    expect(webTargets(rows, "u1").map((t) => [t.device, t.label])).toEqual([
      ["mac-1", "app · Mac 1"],
      ["mac-2", "app · Mac 2"],
    ]);
  });
});

describe("applyCommandChange", () => {
  const a = commandRow({ id: "a" });
  const b = commandRow({ id: "b" });

  it("adds a command it hasn't seen and replaces one it has, in place", () => {
    expect(applyCommandChange([a], { eventType: "INSERT", new: b, old: null })).toEqual([a, b]);
    const claimed = { ...a, status: "claimed" as const };
    expect(applyCommandChange([a, b], { eventType: "UPDATE", new: claimed, old: null })).toEqual([claimed, b]);
  });

  it("drops a deleted command, and ignores a delete that names none", () => {
    expect(applyCommandChange([a, b], { eventType: "DELETE", old: { id: "a" } })).toEqual([b]);
    const list = [a, b];
    expect(applyCommandChange(list, { eventType: "DELETE", old: {} })).toBe(list);
  });
});

describe("commandLine", () => {
  const line = (over: Parameters<typeof commandRow>[0]) => commandLine(commandRow(over));

  it("names the thread by its prompt's first line and says how far it got", () => {
    expect(line({ payload: { prompt: "# Add dark mode\nplease" } }).title).toBe("Add dark mode");
    expect(line({ status: "pending" }).note).toMatch(/Waiting for your Mac/);
    expect(line({ status: "claimed" }).note).toMatch(/Starting/);
    expect(line({ status: "done" }).note).toBe("Started.");
  });

  it("gives the reason a failed one failed, or a plain one", () => {
    expect(line({ status: "failed", error: "Not switched on" }).note).toBe("Not switched on");
    expect(line({ status: "failed", error: null }).note).toMatch(/couldn't start/);
  });

  it("falls back to a title for an empty prompt", () => {
    expect(line({ payload: { prompt: "" } }).title).toBe("New thread");
  });
});

describe("replies", () => {
  const reply = (over: Parameters<typeof commandRow>[0] = {}) => commandRow({ id: "r1", kind: "reply", payload: { cardId: "c1", text: "ship it" }, ...over });

  it("stay out of the board's strip, with answers and stops", () => {
    const answer = reply({ id: "a1", kind: "answer", payload: { cardId: "c1", pendingId: "p1", allow: true } });
    const stop = reply({ id: "s1", kind: "stop", payload: { cardId: "c1" } });
    expect(boardCommands([commandRow(), reply(), answer, stop]).map((c) => c.id)).toEqual(["cmd-1"]);
    expect(cardReplies([answer, stop], "c1").map((c) => c.id)).toEqual(["a1", "s1"]);
  });

  it("leave a worker's sign-ins and clones off the board's strip", () => {
    const admin = (["login", "github_login", "clone"] as const).map((kind) => commandRow({ id: kind, kind }));
    expect(boardCommands([commandRow(), ...admin]).map((c) => c.id)).toEqual(["cmd-1"]);
  });

  it("show under their own card while open or failed, not once done", () => {
    const list = [reply(), reply({ id: "r2", status: "failed" }), reply({ id: "r3", status: "done" }), reply({ id: "r4", payload: { cardId: "c2", text: "x" } }), commandRow()];
    expect(cardReplies(list, "c1").map((c) => c.id)).toEqual(["r1", "r2"]);
  });

  it("can only go to a card your own account runs, and not a deleted one", () => {
    expect(canReply(cardRow(), "u1")).toBe(true);
    expect(canReply(cardRow({ owner_user: "u2" }), "u1")).toBe(false);
    expect(canReply(cardRow({ deleted: true }), "u1")).toBe(false);
  });

  it("say how far they got", () => {
    expect(replyNote(reply())).toMatch(/Waiting for your Mac/);
    expect(replyNote(reply({ status: "claimed" }))).toMatch(/Sending/);
    expect(replyNote(reply({ status: "failed", error: "gone" }))).toBe("gone");
    expect(replyNote(reply({ status: "failed" }))).toMatch(/couldn't send/);
    expect(replyNote(reply({ status: "done" }))).toBe("Sent.");
  });

  it("read as their text in the strip's wording", () => {
    expect(commandLine(reply()).title).toBe("ship it");
  });
});
