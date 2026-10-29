// app/api/web-board/[orgId]/blob-urls/route.ts: the weft.zip board's URL batch. The visitor's own cookie session is the
// access check (lib/blob-urls.ts reads blob_mirror and signs through it), so these cover the shape checks, a
// signed-out visitor, and what reaches the resolver.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { webClient, resolveBlobUrls, queued } = vi.hoisted(() => ({ webClient: vi.fn(), resolveBlobUrls: vi.fn(), queued: vi.fn() }));
vi.mock("@/lib/web-session", () => ({ webClient }));
vi.mock("@/lib/blob-urls", () => ({ resolveBlobUrls }));
vi.mock("@/lib/r2-queue", () => ({ queueMirror: () => queued }));

const ORG = "11111111-2222-3333-4444-555555555555";
const REF = `blob:sha256:${"a".repeat(64)}`;

// The visitor's cookie client: who's signed in, and a marker so the resolver's first argument is checkable.
const CLIENT_MARK = { client: true };
function session(user: { id: string } | null) {
  return { ...CLIENT_MARK, auth: { getUser: () => Promise.resolve({ data: { user } }) } };
}

async function post(body: unknown, orgId = ORG) {
  const { POST } = await import("./route");
  const req = new Request(`http://localhost/api/web-board/${orgId}/blob-urls`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
  return POST(req, { params: Promise.resolve({ orgId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  webClient.mockResolvedValue(session({ id: "u1" }));
  resolveBlobUrls.mockResolvedValue({ [REF]: "https://r2.test/a" });
});

describe("POST /api/web-board/[orgId]/blob-urls", () => {
  it("refuses an org id of the wrong shape", async () => {
    expect((await post({ refs: [REF] }, "../x")).status).toBe(400);
    expect(webClient).not.toHaveBeenCalled();
  });

  it("asks a signed-out visitor to sign in", async () => {
    webClient.mockResolvedValue(session(null));
    expect((await post({ refs: [REF] })).status).toBe(401);
    expect(resolveBlobUrls).not.toHaveBeenCalled();
  });

  it("resolves the blob refs with the visitor's own client, deduped, junk dropped", async () => {
    const res = await post({ refs: [REF, REF, "javascript:alert(1)", 7] });
    expect(await res.json()).toEqual({ urls: { [REF]: "https://r2.test/a" } });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(resolveBlobUrls).toHaveBeenCalledWith(expect.objectContaining(CLIENT_MARK), ORG, [REF], { onUnmirrored: queued });
  });

  it("treats a body that isn't JSON as no refs", async () => {
    await post("not json");
    expect(resolveBlobUrls).toHaveBeenCalledWith(expect.objectContaining(CLIENT_MARK), ORG, [], { onUnmirrored: queued });
  });

  it("caps a batch at 200 refs", async () => {
    const refs = Array.from({ length: 250 }, (_, i) => `blob:sha256:${i.toString(16).padStart(64, "0")}`);
    await post({ refs });
    expect((resolveBlobUrls.mock.calls[0] as [unknown, string, string[]])[2]).toHaveLength(200);
  });
});
