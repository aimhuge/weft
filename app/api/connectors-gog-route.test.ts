import { beforeEach, describe, expect, it, vi } from "vitest";

// Settings → Connectors → Google Workspace: the route behind the gog connector. lib/gog and the guard are
// mocked, so the route's own dispatch — credentials, add, cancel, remove — is what these tests pin.

const state = vi.hoisted(() => ({ denied: false }));

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/guard", () => ({
  guard: () => (state.denied ? Response.json({ error: "Forbidden host" }, { status: 403 }) : null),
  fail: (err: unknown, status = 400) => Response.json({ error: err instanceof Error ? err.message : String(err) }, { status }),
}));
vi.mock("@/lib/gog", () => ({
  gogStatus: vi.fn(() => Promise.resolve({ installed: true, version: "0.47.0" })),
  setGogCredentials: vi.fn(() => Promise.resolve()),
  addGogAccount: vi.fn(),
  cancelGogAdd: vi.fn(),
  removeGogAccount: vi.fn(() => Promise.resolve()),
}));

const gog = await import("@/lib/gog");
const route = await import("./connectors/gog/route");

const URL = "http://localhost:3457/api/connectors/gog";
const READ = { host: "localhost:3457" };
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };
const send = (body: unknown, headers: Record<string, string> = WRITE) => new Request(URL, { method: "POST", headers, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = false;
});

describe("GET /api/connectors/gog", () => {
  it("returns gog's status", async () => {
    const res = await route.GET(new Request(URL, { headers: READ }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ installed: true, version: "0.47.0" });
    expect(gog.gogStatus).toHaveBeenCalled();
  });

  it("reports a failure", async () => {
    vi.mocked(gog.gogStatus).mockRejectedValueOnce(new Error("gog isn't on this app's PATH."));
    const res = await route.GET(new Request(URL, { headers: READ }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("gog isn't on this app's PATH.");
  });

  it("refuses a request the guard denies", async () => {
    state.denied = true;
    const res = await route.GET(new Request(URL, { headers: READ }));
    expect(res.status).toBe(403);
    expect(gog.gogStatus).not.toHaveBeenCalled();
  });
});

describe("POST /api/connectors/gog", () => {
  it("sets the OAuth client credentials", async () => {
    const json = JSON.stringify({ installed: { client_id: "abc" } });
    const res = await route.POST(send({ action: "credentials", json }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ installed: true, version: "0.47.0" });
    expect(gog.setGogCredentials).toHaveBeenCalledWith(json);
  });

  it("adds an account, readonly when asked", async () => {
    await route.POST(send({ action: "add", email: " me@example.com ", readonly: true }));
    expect(gog.addGogAccount).toHaveBeenCalledWith("me@example.com", { readonly: true });

    await route.POST(send({ action: "add", email: "you@example.com" }));
    expect(gog.addGogAccount).toHaveBeenLastCalledWith("you@example.com", { readonly: false });
  });

  it("treats a missing or non-string field as empty", async () => {
    await route.POST(send({ action: "add" }));
    expect(gog.addGogAccount).toHaveBeenCalledWith("", { readonly: false });

    await route.POST(send({ action: "remove", email: 42 }));
    expect(gog.removeGogAccount).toHaveBeenCalledWith("", undefined);

    await route.POST(send({ action: "credentials", json: 7 }));
    expect(gog.setGogCredentials).toHaveBeenCalledWith("");
  });

  it("cancels the sign-in under way", async () => {
    await route.POST(send({ action: "cancel" }));
    expect(gog.cancelGogAdd).toHaveBeenCalled();
  });

  it("removes an account", async () => {
    await route.POST(send({ action: "remove", email: "me@example.com" }));
    expect(gog.removeGogAccount).toHaveBeenCalledWith("me@example.com", undefined);
  });

  it("removes an account through the client it signed in with", async () => {
    await route.POST(send({ action: "remove", email: "me@example.com", client: "mine" }));
    expect(gog.removeGogAccount).toHaveBeenCalledWith("me@example.com", "mine");
  });

  it("refuses an unknown action", async () => {
    const res = await route.POST(send({ action: "wat" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Unknown action. Use credentials, add, cancel or remove.");
    expect(gog.setGogCredentials).not.toHaveBeenCalled();
    expect(gog.addGogAccount).not.toHaveBeenCalled();
    expect(gog.cancelGogAdd).not.toHaveBeenCalled();
    expect(gog.removeGogAccount).not.toHaveBeenCalled();
  });

  it("refuses a request the guard denies", async () => {
    state.denied = true;
    const res = await route.POST(send({ action: "cancel" }));
    expect(res.status).toBe(403);
    expect(gog.cancelGogAdd).not.toHaveBeenCalled();
  });
});
