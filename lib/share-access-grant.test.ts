// lib/share-access.ts's second door: when the gate refuses (sign in, not a member, a password or email form), a
// visitor the owner named by GitHub account gets in anyway (lib/share-grant-gate.ts, the RPC faked in the harness).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cardRow, fakeGate, fromTable, grants, serviceWith, shareRow } from "./share-access.harness";

const { serviceClient: serviceClientMock, webUser: webUserMock, cookies } = vi.hoisted(() => ({
  serviceClient: vi.fn(),
  webUser: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("@/lib/web-session", () => ({ serviceClient: serviceClientMock, webUser: webUserMock }));
vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/share-gate", () => ({ getShareGate: () => fakeGate }));

async function load() {
  vi.resetModules();
  return import("./share-access");
}

beforeEach(() => {
  vi.clearAllMocks();
  grants.admit = false;
  grants.calls = [];
});

describe("shareAccess with a GitHub grant", () => {
  const visitor = { id: "u9", email: "g@x", name: null, avatar: null };
  function svcFor(share: ReturnType<typeof shareRow>) {
    return serviceWith({
      cloud_shares: fromTable("cloud_shares", { share }),
      cloud_cards: fromTable("cloud_cards", { card: cardRow() }),
      org_memberships: fromTable("org_memberships", {}),
    });
  }

  it("lets a granted visitor into a private share they aren't a member of", async () => {
    serviceClientMock.mockReturnValue(svcFor(shareRow({ mode: "private" })));
    webUserMock.mockResolvedValue(visitor);
    grants.admit = true;
    const { shareAccess } = await load();
    expect((await shareAccess("a-valid-share-id")).kind).toBe("ok");
    expect(grants.calls).toEqual([{ name: "share_grant_admits", args: { share: "a-valid-share-id", uid: "u9" } }]);
  });

  it("lets a granted visitor past a password gate", async () => {
    serviceClientMock.mockReturnValue(svcFor(shareRow({ mode: "password" })));
    cookies.mockResolvedValue({ get: () => undefined });
    webUserMock.mockResolvedValue(visitor);
    grants.admit = true;
    const { shareAccess } = await load();
    expect((await shareAccess("a-valid-share-id")).kind).toBe("ok");
  });

  it("keeps the original verdict when the visitor isn't granted", async () => {
    serviceClientMock.mockReturnValue(svcFor(shareRow({ mode: "private" })));
    webUserMock.mockResolvedValue(visitor);
    const { shareAccess } = await load();
    expect(await shareAccess("a-valid-share-id")).toEqual({ kind: "denied" });
    serviceClientMock.mockReturnValue(svcFor(shareRow({ mode: "password" })));
    cookies.mockResolvedValue({ get: () => undefined });
    expect(await shareAccess("a-valid-share-id")).toEqual({ kind: "gate", mode: "password" });
  });

  it("asks no grant for a missing card", async () => {
    serviceClientMock.mockReturnValue(
      serviceWith({ cloud_shares: fromTable("cloud_shares", { share: shareRow({ mode: "private" }) }), cloud_cards: fromTable("cloud_cards", {}) }),
    );
    grants.admit = true;
    const { shareAccess } = await load();
    expect(await shareAccess("a-valid-share-id")).toEqual({ kind: "missing" });
    expect(grants.calls).toEqual([]);
  });
});
