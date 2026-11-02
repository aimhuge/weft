import { describe, expect, it, vi } from "vitest";
import type { CloudCommandRow } from "../cloud-commands";
import type { Card } from "../types";
import { takeClient } from "../turn-client";
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

  it("notes a turn's sender for its <weft-env> block: the row's hint, or 'remote'; a verb that sends no turn notes nothing", async () => {
    const r = rules();
    await cardKinds(r).reply(cmd("reply", { cardId: "k1", text: "go", client: { app: "web", tz: "UTC" } }));
    expect(takeClient("k1")).toEqual({ app: "web", tz: "UTC" });
    await cardKinds(r).host(cmd("host", { verb: "card.message", args: { id: "k1", text: "go" }, client: { app: "desktop", name: "m1", via: "line" } }));
    expect(takeClient("k1")).toEqual({ app: "desktop", name: "m1", via: "line" });
    await cardKinds(r).host(cmd("host", { verb: "card.message", args: { id: "k1", text: "go" } }));
    expect(takeClient("k1")).toEqual({ app: "remote" });
    await cardKinds(r).host(cmd("host", { verb: "card.stop", args: { id: "k1" }, client: { app: "web" } }));
    expect(takeClient("k1")).toBeUndefined();
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
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ kind: "host" }), { id: "n1", prompt: "go (here)", start: false, client: { app: "remote" } });
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

describe("signed widening on the host kind", () => {
  const host = (args: Record<string, unknown>, verb = "card.update") => cmd("host", { verb, args: { id: "k1", ...args } });

  it("runs a widening only once its approval checks out, without the approval, and skips the elevated rule for what it signed", async () => {
    // The Mac's rule refuses anything left in a card.update's body, and the shell.
    const elevated = vi.fn<NonNullable<CardRules["elevated"]>>((verb, args) =>
      Promise.resolve(verb === "card.shell" || Object.keys((args.body as object | undefined) ?? {}).length ? "phone paired" : null),
    );
    const widen = vi.fn<NonNullable<CardRules["widen"]>>(() => Promise.resolve(null));
    const r = rules({ widen, elevated });
    await cardKinds(r).host(host({ body: { cwd: "site" }, widen: { kind: "ed25519" } }));
    expect(widen).toHaveBeenCalledWith({ card: "k1", verb: "card.update", change: { cwd: "site" }, args: { body: { cwd: "site" } } }, { kind: "ed25519" }, expect.stringMatching(/folder/));
    expect(r.verb).toHaveBeenCalledWith("card.update", { id: "k1", body: { cwd: "site" } });
    await cardKinds(r).host(host({ command: "ls", widen: {} }, "card.shell"));
    expect(r.verb).toHaveBeenLastCalledWith("card.shell", { id: "k1", command: "ls" });
    expect(elevated).not.toHaveBeenCalledWith("card.shell", expect.anything());
  });

  it("still holds the unsigned rest of a signed card.update to the elevated rule", async () => {
    const elevated = vi.fn<NonNullable<CardRules["elevated"]>>((_verb, args) =>
      Promise.resolve((args.body as Record<string, unknown>).permissionMode ? "phone paired" : null),
    );
    const r = rules({ widen: () => Promise.resolve(null), elevated });
    // An approval for the agent can't carry a mode it never signed past the Mac's phone rule.
    await expect(cardKinds(r).host(host({ body: { agent: "b", permissionMode: "acceptEdits" }, widen: {} }))).rejects.toThrow("phone paired");
    expect(elevated).toHaveBeenCalledWith("card.update", { id: "k1", body: { permissionMode: "acceptEdits" } });
    expect(r.verb).not.toHaveBeenCalled();
    // Skipping prompts, when it's what was signed, is covered by the approval.
    await cardKinds(r).host(host({ body: { permissionMode: "bypassPermissions", title: "t" }, widen: {} }));
    expect(elevated).toHaveBeenLastCalledWith("card.update", { id: "k1", body: { title: "t" } });
  });

  it("refuses one whose approval doesn't check out, and keeps today's refusal without one or without a check", async () => {
    await expect(cardKinds(rules({ widen: () => Promise.resolve("stale") })).host(host({ body: { agent: "b" }, widen: {} }))).rejects.toThrow("stale");
    await expect(cardKinds(rules({ widen: () => Promise.resolve(null) })).host(host({ body: { agent: "b" } }))).rejects.toThrow(/agent/);
    await expect(cardKinds(rules()).host(host({ body: { agent: "b" }, widen: {} }))).rejects.toThrow(/agent/);
    // The editor's refusals aren't widenings, so no approval lifts them.
    await expect(cardKinds(rules({ widen: () => Promise.resolve(null) })).host(host({ path: ".git/config", widen: {} }, "files.read"))).rejects.toThrow();
  });
});

describe("a verb on the host itself", () => {
  const settings = { maxThreads: 3, keepAliveMinutes: 0, worktreePool: 1, defaultBackend: "claude" };

  it("runs settings.get with no card check, and reports no card", async () => {
    const hostVerb = vi.fn<NonNullable<CardRules["hostVerb"]>>(() => Promise.resolve({ settings }));
    const r = rules({ hostVerb });
    const done = await cardKinds(r).host(cmd("host", { verb: "settings.get", args: { id: "k1" } }));
    expect(done).toEqual({ cardId: "", result: { ok: true, cardId: "", settings } });
    expect(hostVerb).toHaveBeenCalledWith("settings.get", { id: "" });
    expect(r.card).not.toHaveBeenCalled();
    expect(r.verb).not.toHaveBeenCalled();
  });

  it("refuses a setting outside the host's own, and a host that doesn't take them (a Mac)", async () => {
    const hostVerb = vi.fn<NonNullable<CardRules["hostVerb"]>>(() => Promise.resolve({ settings }));
    const put = (patch: unknown) => cmd("host", { verb: "settings.put", args: { patch } });
    await expect(cardKinds(rules({ hostVerb })).host(put({ allowedFolders: ["/"] }))).rejects.toThrow(/can't change allowedFolders/);
    expect(hostVerb).not.toHaveBeenCalled();
    await expect(cardKinds(rules()).host(put({ maxThreads: 2 }))).rejects.toThrow("This host takes its settings only from its own window.");
  });
});
