import { describe, expect, it } from "vitest";
import { BIDI_REFUSED, readPasskeyMessage } from "./approval-passkey";
import { PHONE_ONLY } from "./passkey-phone-only";
import { askIds, loadAsk, NOT_PAIRED, NOT_WAITING, sendApproval, type SignAsk } from "./sign-approve";

const pending = { id: "p1", toolName: "Bash", title: "Run", input: { command: "vercel deploy --prod" } };
const row = (over: Record<string, unknown> = {}) => ({ org_id: "o", card_id: "c1", owner_device: "mac-1", folder: "/w/app", card: { pending, ...over }, deleted: false, updated_at: "t" });
const KEY = { device: "b1", credId: "Y3I" };

function fakeClient(rows: unknown[] | null, { selectError = null as string | null, insertError = null as string | null } = {}) {
  const inserted: unknown[] = [];
  const client = {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ overrideTypes: () => Promise.resolve(selectError ? { data: null, error: { message: selectError } } : { data: rows, error: null }) }) }),
      insert: (r: unknown) => {
        inserted.push({ table, row: r });
        return Promise.resolve({ error: insertError ? { message: insertError } : null });
      },
    }),
  };
  return { client: client as never, inserted };
}

describe("askIds", () => {
  it("reads the card and pending ids, and nothing else", () => {
    expect(askIds("?card=c1&pending=p1&extra=x")).toEqual({ cardId: "c1", pendingId: "p1" });
    expect(askIds("?card=c1")).toBeNull();
    expect(askIds("")).toBeNull();
  });
});

describe("loadAsk", () => {
  const ids = { cardId: "c1", pendingId: "p1" };

  it("reads the waiting ask itself and builds the message the Mac will rebuild", async () => {
    const ask = (await loadAsk(fakeClient([row({ pending: { ...pending, id: "old" } }), row()]).client, ids, KEY, 7)) as SignAsk;
    expect(ask.signed).toMatchObject({ card: "c1", pending: "p1", mac: "mac-1", folder: "/w/app", tool: "Bash", input: pending.input, issuedAt: 7 });
    expect(readPasskeyMessage(ask.approval.message)).toEqual(ask.signed);
  });

  it("says why there's nothing to sign", async () => {
    expect(await loadAsk(fakeClient([row()]).client, ids, null, 7)).toBe(NOT_PAIRED);
    expect(await loadAsk(fakeClient(null, { selectError: "denied" }).client, ids, KEY, 7)).toMatch(/couldn't be read: denied/);
    expect(await loadAsk(fakeClient([]).client, ids, KEY, 7)).toBe(NOT_WAITING);
    expect(await loadAsk(fakeClient([row({ pending: null })]).client, ids, KEY, 7)).toBe(NOT_WAITING);
    expect(await loadAsk(fakeClient([row({ pending: { ...pending, questions: [{}] } })]).client, ids, KEY, 7)).toMatch(/question/);
    expect(await loadAsk(fakeClient([row({ pending: { ...pending, elicitation: {} } })]).client, ids, KEY, 7)).toMatch(/question/);
    expect(await loadAsk(fakeClient([row({ pending: { ...pending, toolName: "mcp__secrets__run" } })]).client, ids, KEY, 7)).toBe(PHONE_ONLY);
    expect(await loadAsk(fakeClient([row({ pending: { ...pending, input: { command: "a‮b" } } })]).client, ids, KEY, 7)).toBe(BIDI_REFUSED);
    expect(await loadAsk(fakeClient([{ ...row(), owner_device: "mac\n1" }]).client, ids, KEY, 7)).toMatch(/characters/);
  });
});

describe("sendApproval", () => {
  it("inserts the signed answer for the Mac that runs the card", async () => {
    const { client, inserted } = fakeClient([row()]);
    const ask = (await loadAsk(client, { cardId: "c1", pendingId: "p1" }, KEY, 7)) as SignAsk;
    const sig = { authenticatorData: "a", clientDataJSON: "j", signature: "s" };
    expect(await sendApproval(client, ask, sig)).toBeNull();
    expect(inserted).toEqual([
      {
        table: "cloud_commands",
        row: { org_id: "o", kind: "answer", target_device: "mac-1", folder: "/w/app", payload: { cardId: "c1", pendingId: "p1", allow: true, auth: { kind: "webauthn", device: "b1", credId: "Y3I", issuedAt: 7, ...sig } } },
      },
    ]);
    expect(await sendApproval(fakeClient([], { insertError: "nope" }).client, ask, sig)).toMatch(/couldn't be sent: nope/);
  });
});
