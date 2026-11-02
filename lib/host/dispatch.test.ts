import { describe, expect, it, vi } from "vitest";
import type { CloudCommandRow } from "../cloud-commands";
import type { Card } from "../types";
import { asAnswer, cardKinds, dispatcher, NO_LISTS, type CardRules } from "./dispatch";

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

  it("runs dev.open only for the owner's own command, and refuses it on a host that can't tell", async () => {
    const open = { ...cmd("host", { verb: "dev.open", args: { id: "k1" } }), created_by: "owner" };
    const mine = rules({ fromOwner: (c) => c.created_by === "owner" });
    await cardKinds(mine).host(open);
    expect(mine.verb).toHaveBeenCalledWith("dev.open", { id: "k1" });
    const other = rules({ fromOwner: (c) => c.created_by === "someone else" });
    await expect(cardKinds(other).host(open)).rejects.toThrow("Only the owner of this card");
    expect(other.verb).not.toHaveBeenCalled();
    const blind = rules();
    await expect(cardKinds(blind).host(open)).rejects.toThrow("Only the owner of this card");
    await cardKinds(blind).host(cmd("host", { verb: "dev.stop", args: { id: "k1" } }));
    expect(blind.verb).toHaveBeenCalledWith("dev.stop", { id: "k1" });
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

  it("makes a card through the host's create rule, never the card check, with its prompt's files brought over", async () => {
    const create = vi.fn<NonNullable<CardRules["create"]>>(() => Promise.resolve("n1"));
    const r = rules({ create, receive: (text) => Promise.resolve(`${text} (here)`) });
    const done = await cardKinds(r).host(cmd("host", { verb: "card.create", args: { id: "n1", prompt: "go", start: false } }));
    expect(done).toEqual({ cardId: "n1", result: { ok: true, cardId: "n1" } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ kind: "host" }), { id: "n1", prompt: "go (here)", start: false });
    expect(r.card).not.toHaveBeenCalled();
    await expect(cardKinds(r).host(cmd("host", { verb: "card.create", args: { id: "n2", prompt: "go", permissionMode: "bypassPermissions" } }))).rejects.toThrow(/skip permission/);
    await expect(cardKinds(rules()).host(cmd("host", { verb: "card.create", args: { id: "n3", prompt: "go" } }))).rejects.toThrow(/new_card/);
    expect(create).toHaveBeenCalledOnce();
  });

  it("holds a new card to the host's elevated rule too, as an update is", async () => {
    const create = vi.fn<NonNullable<CardRules["create"]>>(() => Promise.resolve("n1"));
    const elevated = vi.fn<NonNullable<CardRules["elevated"]>>(() => Promise.resolve("Approve it on the phone."));
    const args = { id: "n1", prompt: "go", permissionMode: "acceptEdits" };
    await expect(cardKinds(rules({ create, elevated })).host(cmd("host", { verb: "card.create", args }))).rejects.toThrow("Approve it on the phone.");
    expect(elevated).toHaveBeenCalledWith("card.create", args);
    expect(create).not.toHaveBeenCalled();
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

describe("a cron or webhook the host keeps", () => {
  const update = cmd("host", { verb: "cron.update", args: { id: "cr1", patch: { enabled: false } } });

  it("runs it through the host's lists rule, with no card check, and leaves the row's card empty", async () => {
    const lists = vi.fn<NonNullable<CardRules["lists"]>>(() => Promise.resolve(null));
    const r = rules({ lists });
    expect(await cardKinds(r).host(update)).toEqual({ cardId: null, result: { ok: true, cardId: "" } });
    expect(lists).toHaveBeenCalledWith("cron.update", { id: "cr1", patch: { enabled: false } });
    expect(r.card).not.toHaveBeenCalled();
    lists.mockResolvedValueOnce("run-1");
    expect(await cardKinds(r).host(cmd("host", { verb: "cron.run", args: { id: "cr1" } }))).toEqual({ cardId: null, result: { ok: true, cardId: "run-1" } });
  });

  it("refuses what the drawers can't change, and a host without the rule refuses them all", async () => {
    const lists = vi.fn<NonNullable<CardRules["lists"]>>(() => Promise.resolve(null));
    const bang = cmd("host", { verb: "cron.update", args: { id: "cr1", patch: { prompt: "!rm -rf /" } } });
    await expect(cardKinds(rules({ lists })).host(bang)).rejects.toThrow(/shell line/);
    const target = cmd("host", { verb: "webhook.update", args: { id: "h1", patch: { target: "http://localhost:9/x" } } });
    await expect(cardKinds(rules({ lists })).host(target)).rejects.toThrow(/can't change a webhook's target/);
    expect(lists).not.toHaveBeenCalled();
    await expect(cardKinds(rules()).host(update)).rejects.toThrow(NO_LISTS);
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
