import { describe, expect, it, vi } from "vitest";
import type { CloudCommandRow } from "../cloud-commands";
import type { Card } from "../types";
import { asAnswer, cardKinds, dispatcher, type CardRules } from "./dispatch";

const cmd = (kind: string, payload: unknown) => ({ id: "c1", kind, folder: "/dev/app", payload }) as CloudCommandRow;
const card = { id: "k1", cwd: "/dev/app", pending: { id: "p1", readScope: { directory: "/data" } } } as unknown as Card;

function rules(over: Partial<CardRules> = {}) {
  const r = {
    card: vi.fn<CardRules["card"]>(() => card),
    verb: vi.fn<CardRules["verb"]>(() => Promise.resolve({ ok: true })),
    grant: vi.fn<CardRules["grant"]>(),
    ...over,
  };
  return r;
}

describe("cardKinds", () => {
  it("sends a reply as card.message, with its pasted files brought over when the host does that", async () => {
    const r = rules({ receive: (text) => Promise.resolve(`${text} (here)`) });
    expect(await cardKinds(r).reply(cmd("reply", { cardId: "k1", text: "go" }))).toBe("k1");
    expect(r.verb).toHaveBeenCalledWith("card.message", { id: "k1", text: "go (here)" });
    await expect(cardKinds(r).reply(cmd("reply", {}))).rejects.toThrow("That reply is empty.");
  });

  it("answers through the approval rule, grants after the answer, and carries a question reply where asked", async () => {
    const after = vi.fn();
    const r = rules({ approve: () => Promise.resolve(null), questionReplies: true, after });
    const answer = cmd("answer", { cardId: "k1", pendingId: "p1", allow: true, grant: "always" });
    expect(await cardKinds(r).answer(answer)).toBe("k1");
    expect(r.verb).toHaveBeenCalledWith("card.permission.answer", expect.objectContaining({ id: "k1", allow: true, pendingId: "p1", annotations: undefined }));
    expect(r.grant).toHaveBeenCalledWith("k1", "/data", "always");
    expect(after).toHaveBeenCalled();
    await expect(cardKinds(rules({ approve: () => Promise.resolve("Sign it on the phone.") })).answer(answer)).rejects.toThrow("Sign it on the phone.");
    await expect(cardKinds(r).answer(cmd("answer", {}))).rejects.toThrow("That answer is empty.");
  });

  it("stops a card, and a host may name its own error for a stop with no card", async () => {
    const r = rules();
    expect(await cardKinds(r).stop(cmd("stop", { cardId: "k1" }))).toBe("k1");
    expect(r.verb).toHaveBeenCalledWith("card.stop", { id: "k1" });
    await expect(cardKinds(rules({ emptyStop: "No card." })).stop(cmd("stop", {}))).rejects.toThrow("No card.");
    await cardKinds(r).stop(cmd("stop", {}));
    expect(r.card).toHaveBeenLastCalledWith(undefined, expect.anything(), "stopped");
  });

  it("answers the editor's verbs with their value, a large one through the host's carry, and syncs nothing after", async () => {
    const after = vi.fn();
    const r = rules({ verb: vi.fn<CardRules["verb"]>(() => Promise.resolve({ files: ["a.ts"] })), after });
    const list = cmd("host", { verb: "files.list", args: { id: "k1" } });
    expect(await cardKinds(r).host(list)).toEqual({ cardId: "k1", result: { ok: true, cardId: "k1", value: { files: ["a.ts"] } } });
    expect(after).not.toHaveBeenCalled();
    const big = { file: { text: "x".repeat(5_000) } };
    const carry = vi.fn(() => Promise.resolve("ab".repeat(32)));
    const read = cmd("host", { verb: "files.read", args: { id: "k1", path: "a.ts" } });
    const carried = await cardKinds(rules({ verb: () => Promise.resolve(big), carry })).host(read);
    expect(carried.result).toEqual({ ok: true, cardId: "k1", blob: "ab".repeat(32) });
    await expect(cardKinds(rules({ verb: () => Promise.resolve(big) })).host(read)).rejects.toThrow("can't send a large result");
  });

  it("runs a host verb, refusing what widens the card and what the host keeps elevated", async () => {
    const r = rules({ elevated: () => Promise.resolve(null) });
    const done = await cardKinds(r).host(cmd("host", { verb: "card.stop", args: { id: "k1" } }));
    expect(done).toEqual({ cardId: "k1", result: { ok: true, cardId: "k1" } });
    await expect(cardKinds(r).host(cmd("host", { verb: "card.shell", args: { id: "k1", command: "ls" } }))).rejects.toThrow();
    const kept = rules({ elevated: () => Promise.resolve("Not from the web.") });
    await expect(cardKinds(kept).host(cmd("host", { verb: "card.stop", args: { id: "k1" } }))).rejects.toThrow("Not from the web.");
  });

  it("sends a host answer through the answer kind where the host asks for that, and straight to the verb otherwise", async () => {
    const payload = { verb: "card.permission.answer", args: { id: "k1", pendingId: "p1", allow: false } };
    const approve = vi.fn(() => Promise.resolve(null));
    expect(await cardKinds(rules({ answerAsKind: true, approve })).host(cmd("host", payload))).toEqual({ cardId: "k1", result: { ok: true, cardId: "k1" } });
    expect(approve).toHaveBeenCalled();
    const plain = rules();
    await cardKinds(plain).host(cmd("host", payload));
    expect(plain.verb).toHaveBeenCalledWith("card.permission.answer", { id: "k1", pendingId: "p1", allow: false });
  });

  it("reads a host answer as an answer kind", () => {
    const out = asAnswer(cmd("host", {}), { verb: "card.permission.answer", args: { id: "k1", pendingId: "p1", allow: true } });
    expect(out.kind).toBe("answer");
    expect(out.payload).toMatchObject({ cardId: "k1", pendingId: "p1", allow: true });
  });
});

describe("dispatcher", () => {
  it("runs a known kind after the host's check, and refuses one it doesn't know", async () => {
    const check = vi.fn((c: CloudCommandRow) => Promise.resolve({ ...c, folder: "/checked" }));
    const run = dispatcher({ reply: (c) => c.folder }, "Update me.", check);
    expect(await run(cmd("reply", {}))).toBe("/checked");
    await expect(run(cmd("nope", {}))).rejects.toThrow("Update me.");
    expect(check).toHaveBeenCalledTimes(1);
    expect(await dispatcher({ reply: () => "k" }, "x")(cmd("reply", {}))).toBe("k");
  });
});

describe("a read verb through the core", () => {
  it("returns skills.list's answer in the result, and doesn't sync after a read", async () => {
    const after = vi.fn();
    const skills = [{ name: "commit", description: "Commit", source: "user" }];
    const r = rules({ verb: vi.fn<CardRules["verb"]>(() => Promise.resolve({ skills })), after });
    const done = await cardKinds(r).host(cmd("host", { verb: "skills.list", args: { id: "k1" } }));
    expect(done.result).toMatchObject({ ok: true, cardId: "k1", skills: [["commit", "Commit", "user"]] });
    expect(after).not.toHaveBeenCalled();
    await cardKinds(r).host(cmd("host", { verb: "card.stop", args: { id: "k1" } }));
    expect(after).toHaveBeenCalledTimes(1);
  });
});
