import { describe, expect, it, vi } from "vitest";

// POST /api/cards/:id/commit, a commit walk-through button (lib/pile-commit.ts is tested on its own).

// lib/show-dir.ts reads DATA_DIR from the store, which these tests mock.
vi.mock("@/lib/show-dir", () => ({ SHOW_DIR: "/weft/show" }));
vi.mock("@/lib/store", () => ({ DATA_DIR: "/weft-data", getCard: (id: string) => (id === "pile" ? { id } : undefined) }));
vi.mock("@/lib/runner", () => ({}));
vi.mock("@/lib/automations", () => ({}));
vi.mock("@/lib/skills", () => ({ PLUGIN_DIR: "/weft/plugin" }));
vi.mock("@/lib/pile-commit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pile-commit")>()),
  commitFromPage: vi.fn(() => Promise.resolve({ ok: true, hash: "abc" })),
}));

const pileCommit = await import("@/lib/pile-commit");
const route = await import("./cards/[id]/commit/route");

function post(id: string, body: unknown, headers: Record<string, string> = { "x-weft-token": "1" }) {
  const req = new Request(`http://localhost:3457/api/cards/${id}/commit`, {
    method: "POST",
    headers: { host: "localhost:3457", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return route.POST(req, { params: Promise.resolve({ id }) });
}

describe("POST /api/cards/:id/commit", () => {
  it("commits with /weft:done's commit.sh and returns the result", async () => {
    const res = await post("pile", { message: "feat: a", paths: ["a.ts"], push: "1", done: "c1" });
    expect(await res.json()).toEqual({ result: { ok: true, hash: "abc" } });
    expect(pileCommit.commitFromPage).toHaveBeenCalledWith(
      "pile",
      { message: "feat: a", paths: ["a.ts"], push: true, done: "c1", change: undefined, label: undefined },
      "/weft/plugin/skills/done/commit.sh",
    );
  });

  it("refuses a write without the header, a missing card and a bad request", async () => {
    expect((await post("pile", {}, {})).status).toBe(403);
    expect((await post("gone", { message: "m", paths: ["a"] })).status).toBe(404);
    const bad = await post("pile", { message: "m", paths: ["../x"] });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("Not a path this commit can take");
  });
});
