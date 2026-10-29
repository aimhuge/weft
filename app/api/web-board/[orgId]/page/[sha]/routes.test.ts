// app/api/web-board/[orgId]/page/[sha]/route.ts: the weft.zip board's pane page. The visitor's cookie client is
// the gate (the bucket's member policy), so these cover the shape checks, a signed-out visitor, a blob the policy
// hides, and the sandbox headers on a page that's served.
import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeClient = { auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> }; storage: unknown };
const { webClient } = vi.hoisted(() => ({ webClient: vi.fn<() => Promise<FakeClient>>() }));
// requestSession reads the cookie session through webClient when there's no bearer token, as the real one does.
vi.mock("@/lib/web-session", () => ({
  requestSession: async () => {
    const supabase = await webClient();
    const { data } = await supabase.auth.getUser();
    return { supabase, user: data.user };
  },
}));

const ORG = "11111111-2222-3333-4444-555555555555";
const SHA = "a".repeat(64);

type Setup = { user?: { id: string } | null; data?: Blob | null; error?: { message: string } | null };

function client({ user = { id: "u1" }, data = null, error = null }: Setup = {}) {
  const download = vi.fn(() => Promise.resolve({ data, error }));
  const from = vi.fn(() => ({ download }));
  webClient.mockResolvedValue({ auth: { getUser: () => Promise.resolve({ data: { user } }) }, storage: { from } });
  return { download, from };
}

async function get(orgId = ORG, sha = SHA) {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/web-board/${orgId}/page/${sha}`), { params: Promise.resolve({ orgId, sha }) });
}

beforeEach(() => vi.clearAllMocks());

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

  it("passes a blob with no type as bytes", async () => {
    client({ data: new Blob([new Uint8Array([1, 2])]) });
    expect((await get()).headers.get("Content-Type")).toBe("application/octet-stream");
  });
});
