import { beforeEach, describe, expect, it, vi } from "vitest";

// The permission route runs this Mac's own answer rule (lib/local-approve.ts) before the verb: an Allow on a phone-only
// ask needs main's signature, checked through POST /pairing/verify; everything else goes through as before.

const store = vi.hoisted(() => ({ DATA_DIR: "/tmp/weft-permission-sign-test", getCard: vi.fn() }));
vi.mock("@/lib/store", () => store);
const shell = vi.hoisted(() => vi.fn(() => Promise.resolve({ ok: true })));
vi.mock("@/lib/browser-shell", () => ({ shell }));
vi.mock("@/lib/device-id", () => ({ deviceId: () => "mac-1" }));
const runVerb = vi.hoisted(() => vi.fn(() => Promise.resolve({ ok: true })));
vi.mock("@/lib/host-api", async (real) => ({ ...(await real<typeof import("@/lib/host-api")>()), runVerb }));

const route = await import("./cards/[id]/permission/route");

const risky = { id: "p1", toolName: "Bash", title: "Run", input: { command: "codex --yolo" } };
const post = (body: unknown) =>
  route.POST(
    new Request("http://localhost:3457/api/cards/c1/permission", { method: "POST", headers: { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "c1" }) },
  );
const auth = () => ({ device: "mac-1", issuedAt: Date.now(), sig: "c2ln" });

beforeEach(() => {
  vi.clearAllMocks();
  store.getCard.mockReturnValue({ id: "c1", pending: risky });
});

describe("POST /cards/:id/permission, this Mac's answer rule", () => {
  it("refuses an unsigned Allow on a phone-only ask, and runs nothing", async () => {
    const res = await post({ allow: true, pendingId: "p1" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/Touch ID/);
    expect(runVerb).not.toHaveBeenCalled();
  });

  it("runs a signed one once main checks it, and refuses one main doesn't", async () => {
    expect((await post({ allow: true, pendingId: "p1", auth: auth() })).status).toBe(200);
    expect(shell).toHaveBeenCalledWith("/pairing/verify", expect.objectContaining({ device: "mac-1", sig: "c2ln" }));
    expect(runVerb).toHaveBeenCalledWith("card.permission.answer", expect.objectContaining({ id: "c1", allow: true, pendingId: "p1" }));
    shell.mockResolvedValueOnce({ ok: false, reason: "nope" } as never);
    const res = await post({ allow: true, pendingId: "p1", auth: auth() });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("nope");
  });

  it("leaves a Deny, a plain Allow, a card it doesn't have and the hold verbs as they were", async () => {
    expect((await post({ allow: false, pendingId: "p1" })).status).toBe(200);
    store.getCard.mockReturnValue({ id: "c1", pending: { ...risky, input: { command: "ls" } } });
    expect((await post({ allow: true, pendingId: "p1" })).status).toBe(200);
    store.getCard.mockReturnValue(undefined);
    expect((await post({ allow: true, pendingId: "p1" })).status).toBe(200);
    expect((await post({ wait: true, pendingId: "p1" })).status).toBe(200);
    expect(store.getCard).toHaveBeenCalledTimes(3);
    expect(shell).not.toHaveBeenCalled();
  });
});
