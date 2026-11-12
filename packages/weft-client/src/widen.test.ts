import { describe, expect, it } from "vitest";
import { canonical, createTerms, freshWiden, readWidenAuth, widenArgsOf, widenChangeOf, widenLabel, widenMessage, withoutWiden, WIDEN_MESSAGE_V, WIDEN_TTL_MS } from "./widen";

describe("widenChangeOf", () => {
  it("names exactly what a command widens, as remoteRefusal refuses it", () => {
    expect(widenChangeOf({ verb: "card.shell", args: { id: "c", command: "ls" } })).toEqual({ shell: "ls" });
    expect(widenChangeOf({ verb: "card.shell", args: { id: "c" } })).toEqual({ shell: "" });
    expect(widenChangeOf({ verb: "card.schedule", args: { id: "c", text: "!make" } })).toEqual({ schedule: "!make" });
    expect(widenChangeOf({ verb: "card.schedule", args: { id: "c", text: "hello" } })).toBeNull();
    expect(widenChangeOf({ verb: "card.schedule", args: { id: "c" } })).toBeNull();
    expect(widenChangeOf({ verb: "card.message", args: { id: "c", text: "!ls" } })).toBeNull();
    expect(widenChangeOf({ verb: "card.update", args: { id: "c" } })).toBeNull();
    expect(widenChangeOf({ verb: "card.update", args: { id: "c", body: "x" } })).toBeNull();
    expect(widenChangeOf({ verb: "card.update", args: { id: "c", body: { title: "t", permissionMode: "auto" } } })).toBeNull();
  });

  it("reads every widening field of an update, and only those", () => {
    const body = { title: "t", cwd: "app", agent: "builder", permissionMode: "bypassPermissions", readScope: "/w/app/docs" };
    expect(widenChangeOf({ verb: "card.update", args: { id: "c", body } })).toEqual({ cwd: "app", agent: "builder", permissionMode: "bypassPermissions", readScope: "/w/app/docs" });
    expect(widenChangeOf({ verb: "card.update", args: { id: "c", body: { agent: 3, cwd: { a: 1 } } } })).toEqual({ agent: null, cwd: '{"a":1}' });
  });
});

describe("widenArgsOf and createTerms", () => {
  it("binds a host verb's args without the approval or the card", () => {
    expect(widenArgsOf({ id: "c", widen: { kind: "x" }, body: { cwd: "a" } })).toEqual({ body: { cwd: "a" } });
  });

  it("reads a new thread's terms as the host starts it", () => {
    const payload = { prompt: " go ", title: "", model: " m ", repo: "r", effort: "high", backend: "codex", permissionMode: "auto", agent: "b", widen: {}, tags: ["x"] };
    expect(createTerms(payload)).toEqual({ prompt: "go", model: "m", repo: "r", effort: "high", backend: "codex", permissionMode: "auto" });
    expect(createTerms({ backend: "rm", permissionMode: "bypassPermissions", prompt: 3 })).toEqual({});
    expect(createTerms(null)).toEqual({});
  });
});

describe("widenMessage", () => {
  const fields = { host: "h", card: "c", verb: "card.update" as const, change: { cwd: "app", agent: "b" }, args: { body: { cwd: "app", agent: "b" } }, nonce: "n".repeat(16), issuedAt: 5 };

  it("is canonical JSON of the fixed fields under its own version", () => {
    const m = widenMessage(fields);
    expect(JSON.parse(m)).toEqual({ v: WIDEN_MESSAGE_V, ...fields });
    expect(m).toBe(widenMessage({ ...fields, change: { agent: "b", cwd: "app" } }));
    expect(m.startsWith('{"args":{"body":{"agent":"b","cwd":"app"}},"card":"c","change":{"agent":"b","cwd":"app"}')).toBe(true);
    expect(widenMessage({ ...fields, host: "other" })).not.toBe(m);
    // The same change with another title, mode or column beside it is another message.
    expect(widenMessage({ ...fields, args: { body: { cwd: "app", agent: "b", permissionMode: "auto" } } })).not.toBe(m);
  });

  it("canonical sorts at every depth and keeps arrays in order", () => {
    expect(canonical({ b: [{ z: 1, a: 2 }], a: null })).toBe('{"a":null,"b":[{"a":2,"z":1}]}');
    expect(canonical(undefined)).toBe("null");
  });
});

describe("readWidenAuth", () => {
  const ed = { kind: "ed25519", device: "mac", issuedAt: 1, nonce: "abcdefghijklmnop", sig: "c2lnbmF0dXJl" };
  const wa = { kind: "webauthn", device: "b", credId: "cred", issuedAt: 1, nonce: "abcdefghijklmnop", authenticatorData: "YQ", clientDataJSON: "Yg", signature: "Yw" };

  it("takes a whole Ed25519 or passkey auth", () => {
    expect(readWidenAuth(ed)).toEqual(ed);
    expect(readWidenAuth({ ...wa, extra: 1 })).toEqual(wa);
  });

  it("refuses anything short of one", () => {
    for (const bad of [null, "x", [], { ...ed, issuedAt: "1" }, { ...ed, issuedAt: Infinity }, { ...ed, nonce: "short" }, { ...ed, nonce: 1 }, { ...ed, device: "" }, { ...ed, sig: "not base64!" }, { ...ed, sig: "" }, { ...ed, kind: "rsa" }, { ...wa, credId: "a+b" }, { ...wa, signature: "" }]) {
      expect(readWidenAuth(bad)).toBeNull();
    }
  });
});

describe("freshWiden and withoutWiden", () => {
  it("lives two minutes either way", () => {
    expect(freshWiden(1000, 1000 + WIDEN_TTL_MS)).toBe(true);
    expect(freshWiden(1000, 1001 + WIDEN_TTL_MS)).toBe(false);
    expect(freshWiden(1000 + WIDEN_TTL_MS + 1, 1000)).toBe(false);
  });

  it("takes the approval off the args a verb runs with", () => {
    const args = { id: "c", body: {} };
    expect(withoutWiden(args)).toBe(args);
    expect(withoutWiden({ ...args, widen: { kind: "ed25519" } })).toEqual(args);
  });
});

describe("tree.snapshot", () => {
  it("is a Mac's ask only when it names a repo; a worker's stays unsigned", () => {
    expect(widenChangeOf({ verb: "tree.snapshot", args: { id: "", folder: "weft", origin: "me/weft", mac: "Air" } })).toEqual({ wip: { folder: "weft", origin: "me/weft", mac: "Air" } });
    expect(widenChangeOf({ verb: "tree.snapshot", args: { folder: "weft", origin: "me/weft" } })).toEqual({ wip: { folder: "weft", origin: "me/weft" } });
    expect(widenChangeOf({ verb: "tree.snapshot", args: { folder: 3, origin: "o", mac: 4 } })).toEqual({ wip: { folder: "", origin: "o" } });
    expect(widenChangeOf({ verb: "tree.snapshot", args: { folder: "weft" } })).toBeNull();
    expect(widenChangeOf({ verb: "tree.snapshot", args: { folder: "weft", origin: 5 } })).toBeNull();
  });

  it("is said in words", () => {
    expect(widenLabel({ wip: { folder: "weft", origin: "me/weft" } })).toBe("send its uncommitted work in weft to me/weft");
  });
});

describe("widenLabel", () => {
  it("says each change in words, cut", () => {
    expect(widenLabel({ cwd: "app", agent: "builder", permissionMode: "bypassPermissions", readScope: "/r" })).toBe(
      "move it to the folder app, give it the agent builder, let it skip permission prompts, let it read from /r",
    );
    expect(widenLabel({ agent: null, readScope: { a: 1 } })).toBe('clear its agent, let it read from {"a":1}');
    expect(widenLabel({ shell: "x".repeat(200) })).toMatch(/^run the shell command x+…$/);
    expect(widenLabel({ schedule: "!ls", terminal: "app", create: { agent: "b", folder: "app", prompt: "p" } })).toBe(
      "schedule the shell line !ls, open a terminal in app, start a thread with the agent b in app",
    );
    expect(widenLabel({})).toBe("change nothing");
  });

  it("says allowing safe SQL in words", () => {
    expect(widenLabel({ safeSql: true })).toBe("let it run SQL a review calls Safe without asking");
    expect(widenLabel({ readScope: "/r", safeSql: true })).toBe("let it read from /r, let it run SQL a review calls Safe without asking");
  });
});

describe("allowing safe SQL", () => {
  it("widens only when an update turns it on", () => {
    expect(widenChangeOf({ verb: "card.update", args: { id: "c1", body: { safeSql: true } } })).toEqual({ safeSql: true });
    expect(widenChangeOf({ verb: "card.update", args: { id: "c1", body: { safeSql: false } } })).toBeNull();
    expect(widenChangeOf({ verb: "card.update", args: { id: "c1", body: { safeSql: "yes" } } })).toBeNull();
    expect(widenChangeOf({ verb: "card.update", args: { id: "c1", body: { safeSql: true, title: "x" } } })).toEqual({ safeSql: true });
  });
});

describe("Goose's provider on a worker", () => {
  it("is the widening of a settings.put that names it, and nothing else of the patch", () => {
    expect(widenChangeOf({ verb: "settings.put", args: { id: "", patch: { maxThreads: 2, gooseProviderId: "openai" } } })).toEqual({ goose: { gooseProviderId: "openai" } });
    expect(widenChangeOf({ verb: "settings.put", args: { id: "", patch: { gooseBaseUrl: "https://x" } } })).toEqual({ goose: { gooseBaseUrl: "https://x" } });
    expect(widenChangeOf({ verb: "settings.put", args: { id: "", patch: { maxThreads: 2 } } })).toBeNull();
    expect(widenChangeOf({ verb: "settings.get", args: { id: "" } })).toBeNull();
  });

  it("says it in words, a cleared one as the default", () => {
    expect(widenLabel({ goose: { gooseProviderId: "litellm", gooseBaseUrl: "http://proxy:4000" } })).toBe("point Goose at the provider litellm and the endpoint http://proxy:4000");
    expect(widenLabel({ goose: { gooseProviderId: "" } })).toBe("point Goose at the provider Goose's own");
    expect(widenLabel({ goose: { gooseBaseUrl: "" } })).toBe("point Goose at the endpoint none");
  });
});
