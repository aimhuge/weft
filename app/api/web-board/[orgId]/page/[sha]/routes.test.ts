// app/api/web-board/[orgId]/page/[sha]/route.ts: the weft.zip board's pane page. The visitor's cookie client is
// the gate (the bucket's member policy), so these cover the shape checks, a signed-out visitor, a blob the policy
// hides, and the sandbox headers on a page that's served.
import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeClient = { auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> } };
const { webClient, queued } = vi.hoisted(() => ({ webClient: vi.fn<() => Promise<FakeClient>>(), queued: vi.fn() }));
vi.mock("@/lib/r2-queue", () => ({ queueMirror: () => queued }));
// requestSession is the cookie path here (no Authorization header); lib/web-session.test.ts covers the bearer one.
vi.mock("@/lib/web-session", () => ({
  webClient,
  requestSession: async () => {
    const supabase = await webClient();
    const { data } = await supabase.auth.getUser();
    return { supabase, user: data.user };
  },
}));

const ORG = "11111111-2222-3333-4444-555555555555";
const SHA = "a".repeat(64);

type Setup = { user?: { id: string } | null; data?: Blob | null; error?: { message: string } | null; mirrored?: boolean };

function client({ user = { id: "u1" }, data = null, error = null, mirrored = false }: Setup = {}) {
  const download = vi.fn(() => Promise.resolve({ data, error }));
  const from = vi.fn(() => ({ download }));
  // blob_mirror, read with the visitor's session: a row only when the blob is copied and the visitor is a member.
  const table = vi.fn(() => ({ select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: mirrored ? [{ sha: SHA }] : [], error: null }) }) }) }));
  webClient.mockResolvedValue({ auth: { getUser: () => Promise.resolve({ data: { user } }) }, storage: { from }, from: table } as FakeClient);
  return { download, from, table };
}

const R2_ENV = { R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s" };

async function get(orgId = ORG, sha = SHA) {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/web-board/${orgId}/page/${sha}`), { params: Promise.resolve({ orgId, sha }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/web-board/[orgId]/page/[sha]", () => {
  it("refuses a sha or org id of the wrong shape before reading anything", async () => {
    expect((await get(ORG, "nope")).status).toBe(400);
    expect((await get("../etc", SHA)).status).toBe(400);
    expect(webClient).not.toHaveBeenCalled();
  });

  it("asks a signed-out visitor to sign in", async () => {
    const { download } = client({ user: null });
    expect((await get()).status).toBe(401);
    expect(download).not.toHaveBeenCalled();
  });

  it("is a 404 when the member policy hides the blob", async () => {
    client({ error: { message: "not found" } });
    expect((await get()).status).toBe(404);
  });

  it("serves the page from the workspace's folder with the sandbox on", async () => {
    const { download, from } = client({ data: new Blob(["<h1>hi</h1>"], { type: "text/html" }) });
    const res = await get();
    expect(from).toHaveBeenCalledWith("weft-blobs");
    expect(download).toHaveBeenCalledWith(`${ORG}/${SHA}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toBe("sandbox allow-scripts allow-popups allow-forms");
    expect(res.headers.get("Content-Type")).toBe("text/html");
    expect(await res.text()).toBe("<h1>hi</h1>");
  });

  it("signs the asset refs an HTML page names as the visitor, and leaves other types alone", async () => {
    const ref = `blob:sha256:${"b".repeat(64)}`;
    const { from } = client({ data: new Blob([`<img src="${ref}">`], { type: "text/html" }) });
    const signed = vi.fn(() => Promise.resolve({ data: [{ path: `${ORG}/${"b".repeat(64)}`, signedUrl: "https://sb/signed-b" }], error: null }));
    from.mockImplementation(() => ({ download: vi.fn(() => Promise.resolve({ data: new Blob([`<img src="${ref}">`], { type: "text/html" }), error: null })), createSignedUrls: signed }));
    expect(await (await get()).text()).toBe(`<img src="https://sb/signed-b">`);
    client({ data: new Blob([ref], { type: "text/plain" }) });
    expect(await (await get()).text()).toBe(ref);
  });

  it("passes a blob with no type as bytes", async () => {
    client({ data: new Blob([new Uint8Array([1, 2])]) });
    expect((await get()).headers.get("Content-Type")).toBe("application/octet-stream");
  });
});

describe("GET /api/web-board/[orgId]/page/[sha] with R2", () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(R2_ENV)) vi.stubEnv(k, v);
  });

  it("serves a copied blob from R2 once the member policy shows its row", async () => {
    const { download } = client({ mirrored: true });
    const fetchMock = vi.fn().mockResolvedValue(new Response("<p>r2</p>", { status: 200, headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await get();
    expect(await res.text()).toBe("<p>r2</p>");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`.r2.cloudflarestorage.com/weft-blobs/${ORG}/${SHA}`);
    expect(download).not.toHaveBeenCalled();
    expect(queued).not.toHaveBeenCalled();
  });

  it("reads Supabase for a blob not copied yet, never R2, and queues the copy", async () => {
    const { download } = client({ data: new Blob(["sb"], { type: "text/html" }) });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await (await get()).text()).toBe("sb");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalled();
    expect(queued).toHaveBeenCalledWith(SHA);
  });
});
