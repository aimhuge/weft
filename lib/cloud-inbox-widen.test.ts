// Signed widening on this Mac (lib/cloud-inbox-cards.ts): a widening from the web runs only with an approval main
// checks (POST /pairing/verify, /pairing/passkey-verify) over the message rebuilt from this Mac's id, once, and a card
// moves only to a synced folder; a new card takes an agent only with its own approval.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { command, control, db, listening, reports, resetInbox } from "./cloud-inbox.harness";
import type { CloudCommandRow } from "./cloud-commands";
import { widenMessage } from "./widen";

vi.mock("./account", async () => (await import("./cloud-inbox.harness")).accountMock);
vi.mock("./settings", async () => (await import("./cloud-inbox.harness")).settingsMock);
vi.mock("./device-id", async () => (await import("./cloud-inbox.harness")).deviceMock);
vi.mock("./desktop-worker", async () => (await import("./cloud-inbox.harness")).desktopWorkerMock);
vi.mock("./device-calls", async () => (await import("./cloud-inbox.harness")).deviceCallsMock);
vi.mock("./cloud-sync", async () => (await import("./cloud-inbox.harness")).cloudSyncMock);
vi.mock("./new-card", async () => (await import("./cloud-inbox.harness")).newCardMock);
vi.mock("./runner", async () => (await import("./cloud-inbox.harness")).runnerMock);
vi.mock("./host-api", async (real) => (await import("./cloud-inbox.harness")).hostApiMock(real));
vi.mock("./store", async () => (await import("./cloud-inbox.harness")).storeMock);
// Main's nonce book (electron/widen-nonces.cjs): a nonce is spent once.
const spent = vi.hoisted(() => new Set<string>());
const shellMock = vi.hoisted(() =>
  vi.fn((route: string, body?: Record<string, unknown>) => {
    if (route === "/pairing/status") return Promise.resolve({ approvers: 1, webApprovals: false });
    if (route !== "/pairing/widen-nonce") return Promise.resolve({ ok: true });
    const fresh = !spent.has(String(body?.nonce));
    spent.add(String(body?.nonce));
    return Promise.resolve({ ok: fresh });
  }),
);
vi.mock("./browser-shell", () => ({ shell: shellMock }));

const { refreshCloudInbox } = await import("./cloud-inbox");
const { macConfine } = await import("./cloud-inbox-cards");

const run = (row: CloudCommandRow) => {
  db.updates.length = 0;
  db.pending = [row];
  return listening(refreshCloudInbox);
};
let n = 0;
const auth = (kind = "ed25519") => {
  const nonce = `nonce-${String(++n).padStart(12, "0")}`;
  return kind === "ed25519"
    ? { kind, device: "mac-1", issuedAt: Date.now(), nonce, sig: "c2ln" }
    : { kind, device: "b1", credId: "cred", issuedAt: Date.now(), nonce, authenticatorData: "YQ", clientDataJSON: "Yg", signature: "Yw" };
};
const host = (args: Record<string, unknown>, verb = "card.update") => command({ id: `cmd-${++n}`, kind: "host", payload: { verb, args: { id: "card-7", ...args } } as never });

beforeEach(() => {
  resetInbox();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  control.cards.set("card-7", { id: "card-7", cwd: "/dev/app" });
  control.folders = ["/dev/app", "/dev/site"];
  shellMock.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("a signed widening from the web", () => {
  it("moves a card to another synced folder once main checks the approval over this Mac's own message", async () => {
    const a = auth();
    await run(host({ body: { cwd: "/dev/site" }, widen: a }));
    expect(control.verbs).toEqual([{ verb: "card.update", args: { id: "card-7", body: { cwd: "/dev/site" } } }]);
    const message = widenMessage({ host: "mac-1", card: "card-7", verb: "card.update", change: { cwd: "/dev/site" }, nonce: a.nonce, issuedAt: a.issuedAt });
    expect(shellMock).toHaveBeenCalledWith("/pairing/verify", { device: "mac-1", message, sig: "c2ln" });
    expect(shellMock).toHaveBeenCalledWith("/pairing/widen-nonce", { nonce: a.nonce, issuedAt: a.issuedAt });
    // The same approval again is spent: main says so, not a file in ~/.weft a thread could edit.
    await run(host({ body: { cwd: "/dev/site" }, widen: a }));
    expect(reports()[0]?.error).toMatch(/used already/);
  });

  it("takes a passkey's approval through main's passkey check", async () => {
    await run(host({ body: { agent: "builder" }, widen: auth("webauthn") }));
    expect(shellMock).toHaveBeenCalledWith("/pairing/passkey-verify", expect.objectContaining({ device: "b1", credId: "cred" }));
    expect(control.verbs).toHaveLength(1);
  });

  it("refuses a folder that isn't synced, and without an approval keeps today's refusal", async () => {
    await run(host({ body: { cwd: "/" }, widen: auth() }));
    expect(reports()[0]?.error).toMatch(/isn't switched on/);
    await run(host({ command: "ls" }, "card.shell"));
    expect(reports()[0]?.error).toMatch(/only runs from Weft's own window/);
    expect(control.verbs).toEqual([]);
  });

  it("starts a new card with an agent only with its approval", async () => {
    const card = (payload: Record<string, unknown>) => command({ id: `cmd-${++n}`, kind: "new_card", folder: "/dev/app", payload: { prompt: "go", start: false, ...payload } as never });
    await run(card({ agent: "builder", widen: auth() }));
    expect(control.made.at(-1)).toMatchObject({ agent: "builder", prompt: "go" });
    await run(card({ agent: "builder" }));
    expect(reports()[0]?.error).toMatch(/needs your approval/);
  });
});

describe("macConfine", () => {
  it("lets a change with no folder through", () => {
    expect(macConfine({ agent: "b" })).toBeNull();
  });
});
