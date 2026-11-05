// An Allow from weft.zip signed with a paired browser's passkey (lib/approval-passkey-check.ts), end to end through the
// inbox: the message is rebuilt from this Mac's own names, main checks it against the pin (POST /pairing/passkey-verify,
// played here by electron/passkey-verify.cjs), and only then does the request run.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { command, control, db, listening, reports, resetInbox } from "./cloud-inbox.harness";
import type { CloudCommandRow } from "./cloud-commands";
import { passkeyMessage } from "./approval-passkey";
import { makePasskey, type TestPasskey } from "./passkey.harness";
import { passkeyOrigins, verifyPasskeyAssertion } from "../electron/passkey-verify.cjs";

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
const shellMock = vi.hoisted(() => vi.fn<(route: string, body?: unknown) => Promise<Record<string, unknown>>>(() => Promise.resolve({ ok: true })));
vi.mock("./browser-shell", () => ({ shell: shellMock }));

const { refreshCloudInbox } = await import("./cloud-inbox");

let passkey: TestPasskey;
beforeAll(async () => {
  passkey = await makePasskey();
});

const PENDING = { id: "p1", toolName: "Bash", title: "Run", input: { command: "vercel deploy --prod" } };

// Web Crypto answers on a later turn than the harness waits for, so wait for the report itself.
async function run(row: CloudCommandRow) {
  resetInbox();
  control.cards.set("card-7", { id: "card-7", cwd: "/dev/app", pending: PENDING });
  db.pending = [row];
  await listening(refreshCloudInbox);
  await vi.waitFor(() => expect(reports()).toHaveLength(1));
}

async function signedAnswer(input = PENDING.input) {
  const issuedAt = Date.now();
  const message = passkeyMessage({ orgId: "org1", macDevice: "mac-1", cardId: "card-7", pendingId: "p1", allow: true, issuedAt }, { toolName: "Bash", input, folder: "/dev/app" });
  const auth = { kind: "webauthn", device: "browser-1", credId: "Y3JlZA", issuedAt, ...(await passkey.sign(message)) };
  return command({ id: "cmd-a", kind: "answer", payload: { cardId: "card-7", pendingId: "p1", allow: true, auth } as never });
}

beforeEach(() => {
  vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:1");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  shellMock.mockImplementation((route: string, body?: unknown) => {
    if (route === "/pairing/status") return Promise.resolve({ approvers: 1 });
    if (route !== "/pairing/passkey-verify") return Promise.resolve({ ok: true });
    const b = body as { message: string; authenticatorData: string; clientDataJSON: string; signature: string };
    return Promise.resolve(verifyPasskeyAssertion(b, { publicKey: passkey.publicKey, counter: 0 }, b.message, passkeyOrigins(null)) as Record<string, unknown>);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a passkey-signed Allow from weft.zip", () => {
  it("runs once main's pinned key verifies it, and keeps the counter", async () => {
    await run(await signedAnswer());
    expect(shellMock.mock.calls.find(([route]) => route === "/pairing/passkey-verify")?.[1]).toMatchObject({ device: "browser-1", credId: "Y3JlZA" });
    expect(shellMock).not.toHaveBeenCalledWith("/pairing/verify", expect.anything());
    expect(control.answerPermission).toHaveBeenCalledWith("card-7", true, undefined, "p1", undefined);
  });

  it("is refused when it signed another input, or main doesn't know the passkey", async () => {
    await run(await signedAnswer({ command: "rm -rf ~" }));
    expect(reports()[0]?.error).toMatch(/different approval/);
    shellMock.mockImplementation((route: string) => Promise.resolve(route === "/pairing/status" ? { approvers: 1 } : { ok: false, reason: "That passkey isn't paired with this Mac." }));
    await run(await signedAnswer());
    expect(reports()[0]?.error).toBe("That passkey isn't paired with this Mac.");
    expect(control.answerPermission).not.toHaveBeenCalled();
  });
});
