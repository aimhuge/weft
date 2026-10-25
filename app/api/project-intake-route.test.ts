import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/projects/intake: a project opened on the board, taken in by lib/project-intake.ts (mocked here).

const intakeProject = vi.fn();
vi.mock("@/lib/project-intake", async (orig) => ({ ...(await orig<typeof import("@/lib/project-intake")>()), intakeProject }));

const route = await import("./projects/intake/route");

const post = (body: unknown, headers: Record<string, string> = { "x-weft-token": "1" }) =>
  route.POST(new Request("http://localhost:3457/api/projects/intake", { method: "POST", headers: { host: "localhost:3457", "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

const NONE = { imported: 0, importedFrom: [], blanks: 0, hooks: 0, tracked: [] };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/projects/intake", () => {
  it("takes the folder in and adds the toast's text", async () => {
    intakeProject.mockResolvedValue({ ...NONE, imported: 2, importedFrom: [".env.local"] });
    const res = await post({ folder: os.tmpdir() });
    expect(await res.json()).toMatchObject({ imported: 2, text: "Moved 2 secrets from .env.local into 🔐." });
    expect(intakeProject).toHaveBeenCalledTimes(1);
  });

  it("says null when nothing was taken in", async () => {
    intakeProject.mockResolvedValue(NONE);
    expect(await (await post({ folder: os.tmpdir() })).json()).toMatchObject({ text: null });
  });

  it("refuses a missing folder, and a request without the token", async () => {
    expect((await post({ folder: " " })).status).toBe(400);
    expect((await post({ folder: os.tmpdir() }, {})).status).toBe(403);
    expect(intakeProject).not.toHaveBeenCalled();
  });
});
