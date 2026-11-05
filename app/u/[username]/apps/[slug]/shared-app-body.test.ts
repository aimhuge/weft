// app/u/[username]/apps/[slug]/shared-app-body.tsx: the body of /@<user>/apps/<slug> and
// /<org>/apps/<slug>. The gate branch needs the share's id to build the unlock URL; before the
// fix the body referenced `share.id` before `share` was defined. This test asserts the gate
// branch renders ShareGateForm with an unlockUrl built from the share row (a separate read),
// not from the (unavailable) verdict. The body would throw ReferenceError on the gate branch
// before the fix; after the fix the gate branch returns a JSX element with the right props.
import { beforeEach, describe, expect, it, vi } from "vitest";

const accessMock = vi.hoisted(() => ({
  appShareAccessBySlug: vi.fn(),
  loadAppShareBySlug: vi.fn(),
}));
const webSessionMock = vi.hoisted(() => ({ serviceClient: vi.fn() }));
const navMock = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
const nextServerMock = vi.hoisted(() => ({
  connection: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/app-share-access", () => accessMock);
vi.mock("@/lib/web-session", () => webSessionMock);
vi.mock("@aimhuge/share/client", () => ({ ShareGateForm: () => null }));
vi.mock("next/navigation", () => navMock);
vi.mock("next/server", () => nextServerMock);

const { SharedAppPageBody } = await import("./shared-app-body");
const { ShareNotice, SignInNotice } = await import("@/components/share-view/ShareNotice");

const SHARE_ROW = {
  id: "share-abc-123",
  org_id: "org-1",
  app_id: "app-1",
  mode: "email",
  kind: "blob",
  page: "blob:sha256:" + "a".repeat(64),
  password_hash: null,
  has_password: false,
  created_by: "u1",
  owner: "user",
  slug: "growth",
  files: null,
  manifest: null,
  created_at: "2026-10-18T00:00:00.000Z",
  updated_at: "2026-10-18T00:00:00.000Z",
  name: "Growth",
} as const;

async function renderBodyUser(ownerSlug: string, slug: string) {
  const params = Promise.resolve({ username: ownerSlug, slug });
  return await SharedAppPageBody({ params, owner: "user" });
}

async function renderBodyOrg(ownerSlug: string, slug: string) {
  const params = Promise.resolve({ org: ownerSlug, slug });
  return await SharedAppPageBody({ params, owner: "org" });
}

// Server components return a JSX element (not rendered output). Props live on `.props`.
function propsOf(node: unknown): Record<string, unknown> {
  return (node as { props: Record<string, unknown> }).props;
}

beforeEach(() => {
  vi.clearAllMocks();
  webSessionMock.serviceClient.mockReturnValue({});
});

describe("SharedAppPageBody (the gate branch)", () => {
  it("renders ShareGateForm with the share id from loadAppShareBySlug, not from a missing `share`", async () => {
    accessMock.appShareAccessBySlug.mockResolvedValue({ kind: "gate", mode: "email" });
    accessMock.loadAppShareBySlug.mockResolvedValue({ ...SHARE_ROW, id: "share-abc-123" });
    const node = await renderBodyUser("fotoflo", "growth");
    expect(propsOf(node)).toEqual({
      title: "Shared app",
      mode: "email",
      unlockUrl: "/api/a/share-abc-123/unlock",
      noun: "app",
    });
    expect(accessMock.loadAppShareBySlug).toHaveBeenCalledWith(expect.anything(), { owner: "user", ownerSlug: "fotoflo", slug: "growth" });
  });

  it("renders the same gate form for an org-owned share, with the share id from the second read", async () => {
    accessMock.appShareAccessBySlug.mockResolvedValue({ kind: "gate", mode: "password" });
    accessMock.loadAppShareBySlug.mockResolvedValue({ ...SHARE_ROW, id: "share-org-9" });
    const node = await renderBodyOrg("aimhuge", "growth");
    expect(propsOf(node)).toMatchObject({ unlockUrl: "/api/a/share-org-9/unlock", mode: "password" });
    expect(accessMock.loadAppShareBySlug).toHaveBeenCalledWith(expect.anything(), { owner: "org", ownerSlug: "aimhuge", slug: "growth" });
  });

  it("404s when the gate verdict comes back but the share row has been removed in between", async () => {
    accessMock.appShareAccessBySlug.mockResolvedValue({ kind: "gate", mode: "email" });
    accessMock.loadAppShareBySlug.mockResolvedValue(null);
    await expect(renderBodyUser("fotoflo", "growth")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("does not call loadAppShareBySlug when the verdict is missing (404 short-circuits before the gate read)", async () => {
    accessMock.appShareAccessBySlug.mockResolvedValue({ kind: "missing" });
    await expect(renderBodyUser("fotoflo", "growth")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(accessMock.loadAppShareBySlug).not.toHaveBeenCalled();
  });
});

describe("SharedAppPageBody (the other branches stay intact)", () => {
  it("renders a ShareNotice for an unconfigured server", async () => {
    accessMock.appShareAccessBySlug.mockResolvedValue({ kind: "unconfigured" });
    const node = await renderBodyUser("fotoflo", "growth");
    expect(node).toEqual(expect.objectContaining({ type: ShareNotice }));
  });

  it("renders a ShareNotice for a denied verdict", async () => {
    accessMock.appShareAccessBySlug.mockResolvedValue({ kind: "denied" });
    const node = await renderBodyUser("fotoflo", "growth");
    expect(node).toEqual(expect.objectContaining({ type: ShareNotice }));
  });

  // A redirect thrown inside the streamed <Suspense> body left the page on "Loading the app…" for good,
  // so a signed-out visitor gets a sign-in card instead, with the public URL as ?next.
  it("shows a sign-in card with the public URL as ?next, not a redirect", async () => {
    accessMock.appShareAccessBySlug.mockResolvedValue({ kind: "login" });
    const node = await renderBodyUser("fotoflo", "growth");
    expect(node).toEqual(expect.objectContaining({ type: SignInNotice, props: { next: "/@fotoflo/apps/growth" } }));
    expect(navMock.redirect).not.toHaveBeenCalled();
  });

  it("shows a sign-in card with the org public URL as ?next", async () => {
    accessMock.appShareAccessBySlug.mockResolvedValue({ kind: "login" });
    const node = await renderBodyOrg("aimhuge", "growth");
    expect(node).toEqual(expect.objectContaining({ type: SignInNotice, props: { next: "/aimhuge/apps/growth" } }));
  });
});