import { beforeEach, describe, expect, it, vi } from "vitest";

// Settings → Agents: the agents you made, the built-ins you edited, and each project's default.
// The store and the guard are mocked, so what's pinned here is the routes' own shape: the json each
// one answers, and that a soul can only be written by Weft's own window (elevated), never a thread's curl.

const state = vi.hoisted(() => ({ guardDenied: false, elevatedDenied: false }));

vi.mock("next/server", () => ({ connection: async () => {} }));

vi.mock("@/lib/agent-store", () => ({
  listAgents: vi.fn(() => []),
  projectAgents: vi.fn(() => ({})),
  createAgent: vi.fn(),
  setProjectAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  resetAgent: vi.fn(),
}));

vi.mock("@/lib/new-card", () => ({
  createCardFromBody: vi.fn((body: Record<string, unknown>) => ({ id: "c1", title: "Write an agent", ...body })),
  startCard: vi.fn(() => ({ started: true })),
}));

vi.mock("@/lib/show", () => ({
  showFile: (id: string) => `/tmp/show/${id}.html`,
  writeShowFile: vi.fn(),
  openShowFile: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/store")>()),
  getCard: vi.fn((id: string) => ({ id, title: "Write an agent" })),
}));

vi.mock("@/lib/guard", () => ({
  guard: () => (state.guardDenied ? Response.json({ error: "Forbidden host" }, { status: 403 }) : null),
  elevated: () => (state.elevatedDenied ? Response.json({ error: "This change needs Weft's own window" }, { status: 403 }) : null),
  fail: (err: unknown, status = 400) => Response.json({ error: err instanceof Error ? err.message : String(err) }, { status }),
}));

const store = await import("@/lib/agent-store");
const newCard = await import("@/lib/new-card");
const show = await import("@/lib/show");
const route = await import("./agents/route");
const agentRoute = await import("./agents/[id]/route");
const resetRoute = await import("./agents/[id]/reset/route");
const authorRoute = await import("./agents/author/route");
const designRoute = await import("./agents/design/route");
const URL = "http://localhost:3457/api/agents";
const READ = { host: "localhost:3457" };
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };

const ctx = (id: string): { params: Promise<{ id: string }> } => ({ params: Promise.resolve({ id }) });

function req(method: string, body?: unknown, headers: Record<string, string> = WRITE) {
  return new Request(URL, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const body = (res: Response) => res.json() as Promise<Record<string, unknown>>;

beforeEach(() => {
  vi.clearAllMocks();
  state.guardDenied = false;
  state.elevatedDenied = false;
});

describe("/api/agents", () => {
  it("GET returns every agent and each project's default", async () => {
    vi.mocked(store.listAgents).mockReturnValueOnce([{ id: "builder", name: "Builder", emoji: "🤖", tagline: "", soul: "You build." }] as never);
    vi.mocked(store.projectAgents).mockReturnValueOnce({ "/work/app": "a-1" });
    const res = route.GET(new Request(URL, { headers: READ }));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({
      agents: [{ id: "builder", name: "Builder", emoji: "🤖", tagline: "", soul: "You build." }],
      projects: { "/work/app": "a-1" },
    });
  });

  it("GET is refused when the guard denies", () => {
    state.guardDenied = true;
    const res = route.GET(new Request(URL, { headers: READ }));
    expect(res.status).toBe(403);
    expect(store.listAgents).not.toHaveBeenCalled();
  });

  it("POST creates the agent and answers { agent }", async () => {
    const agent = { id: "a-1", name: "Ada", emoji: "🤖", tagline: "one line", soul: "who it is" };
    vi.mocked(store.createAgent).mockReturnValueOnce(agent);
    const res = await route.POST(req("POST", { name: "Ada", soul: "who it is" }));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ agent });
    expect(store.createAgent).toHaveBeenCalledWith({ name: "Ada", soul: "who it is" });
  });

  it("POST is refused when elevated denies, so a thread's curl can't write a soul", async () => {
    state.elevatedDenied = true;
    const res = await route.POST(req("POST", { name: "Ada", soul: "who it is" }));
    expect(res.status).toBe(403);
    expect(store.createAgent).not.toHaveBeenCalled();
  });

  it("POST answers 400 with { error } when the store throws", async () => {
    vi.mocked(store.createAgent).mockImplementationOnce(() => {
      throw new Error("An agent needs a name.");
    });
    const res = await route.POST(req("POST", {}));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("An agent needs a name.");
  });

  it("PUT sets the project's default agent", async () => {
    vi.mocked(store.projectAgents).mockReturnValueOnce({ "/work/app": "a-1" });
    const res = await route.PUT(req("PUT", { cwd: "/work/app", agent: "a-1" }));
    expect(res.status).toBe(200);
    expect(store.setProjectAgent).toHaveBeenCalledWith("/work/app", "a-1");
    expect(await body(res)).toEqual({ projects: { "/work/app": "a-1" } });
  });

  it("PUT passes null for an agent that isn't a string (Builder clears the folder)", async () => {
    const res = await route.PUT(req("PUT", { cwd: "/work/app", agent: 7 }));
    expect(res.status).toBe(200);
    expect(store.setProjectAgent).toHaveBeenCalledWith("/work/app", null);
  });

  it("PUT is refused when elevated denies", async () => {
    state.elevatedDenied = true;
    const res = await route.PUT(req("PUT", { cwd: "/work/app", agent: "a-1" }));
    expect(res.status).toBe(403);
    expect(store.setProjectAgent).not.toHaveBeenCalled();
  });

  it("PUT answers 400 with { error } when the store throws", async () => {
    vi.mocked(store.setProjectAgent).mockImplementationOnce(() => {
      throw new Error("No such agent.");
    });
    const res = await route.PUT(req("PUT", { cwd: "/work/app", agent: "nope" }));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("No such agent.");
  });
});

describe("/api/agents/[id]", () => {
  it("PATCH updates the agent and answers { agent }", async () => {
    const agent = { id: "a-1", name: "Ada", emoji: "🤖", tagline: "one line", soul: "a new soul" };
    vi.mocked(store.updateAgent).mockReturnValueOnce(agent);
    const res = await agentRoute.PATCH(req("PATCH", { soul: "a new soul" }), ctx("a-1"));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ agent });
    expect(store.updateAgent).toHaveBeenCalledWith("a-1", { soul: "a new soul" });
  });

  it("PATCH is refused when elevated denies, so a thread's curl can't write a soul", async () => {
    state.elevatedDenied = true;
    const res = await agentRoute.PATCH(req("PATCH", { soul: "a new soul" }), ctx("a-1"));
    expect(res.status).toBe(403);
    expect(store.updateAgent).not.toHaveBeenCalled();
  });

  it("PATCH answers 400 with { error } when the store throws", async () => {
    vi.mocked(store.updateAgent).mockImplementationOnce(() => {
      throw new Error("No such agent.");
    });
    const res = await agentRoute.PATCH(req("PATCH", { soul: "a new soul" }), ctx("a-1"));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("No such agent.");
  });

  it("DELETE removes the agent and answers { ok: true }", async () => {
    const res = await agentRoute.DELETE(req("DELETE"), ctx("a-1"));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ ok: true });
    expect(store.deleteAgent).toHaveBeenCalledWith("a-1");
  });

  it("DELETE is refused when elevated denies", async () => {
    state.elevatedDenied = true;
    const res = await agentRoute.DELETE(req("DELETE"), ctx("a-1"));
    expect(res.status).toBe(403);
    expect(store.deleteAgent).not.toHaveBeenCalled();
  });

  it("DELETE answers 400 with { error } when the store throws", async () => {
    vi.mocked(store.deleteAgent).mockImplementationOnce(() => {
      throw new Error("Builder is built in: reset it instead.");
    });
    const res = await agentRoute.DELETE(req("DELETE"), ctx("a-1"));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("Builder is built in: reset it instead.");
  });
});

describe("/api/agents/[id]/reset", () => {
  it("resets the built-in and answers { agent, from }", async () => {
    const agent = { id: "builder", name: "Builder", emoji: "🤖", tagline: "", soul: "the shipped soul" };
    vi.mocked(store.resetAgent).mockResolvedValueOnce({ agent, from: "github" } as never);
    const res = await resetRoute.POST(req("POST"), ctx("builder"));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ agent, from: "github" });
    expect(store.resetAgent).toHaveBeenCalledWith("builder");
  });

  it("is refused when elevated denies", async () => {
    state.elevatedDenied = true;
    const res = await resetRoute.POST(req("POST"), ctx("builder"));
    expect(res.status).toBe(403);
    expect(store.resetAgent).not.toHaveBeenCalled();
  });

  it("answers 400 with { error } when the store throws", async () => {
    vi.mocked(store.resetAgent).mockRejectedValueOnce(new Error("Only a built-in agent resets."));
    const res = await resetRoute.POST(req("POST"), ctx("a-1"));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("Only a built-in agent resets.");
  });
});

describe("/api/agents/author", () => {
  it("starts a card that writes the agent, and answers the card", async () => {
    const res = await authorRoute.POST(req("POST", { what: "Reviews pull requests." }));
    expect(res.status).toBe(200);
    expect((await body(res)).card).toMatchObject({ id: "c1" });
    const newCard = vi.mocked((await import("@/lib/new-card")).createCardFromBody);
    expect(newCard).toHaveBeenCalled();
    // The card's prompt is the brief, so the thread knows what a soul is.
    const prompt = (newCard.mock.calls[0]?.[0] as Record<string, unknown>).prompt as string;
    expect(prompt).toContain("Reviews pull requests.");
  });

  it("is refused when elevated denies, so a thread's curl can't start one", async () => {
    state.elevatedDenied = true;
    const res = await authorRoute.POST(req("POST", { what: "Reviews pull requests." }));
    expect(res.status).toBe(403);
    expect((await import("@/lib/new-card")).createCardFromBody).not.toHaveBeenCalled();
  });

  it("answers 400 when there is no brief to write the agent from", async () => {
    const res = await authorRoute.POST(req("POST", { what: "   " }));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toContain("Say what the agent is for");
  });
});

describe("/api/agents/design", () => {
  it("starts the thread that designs the agent, with the brief as its prompt", async () => {
    const res = await designRoute.POST(req("POST", { project: "/dev/app", job: "triages GitHub issues" }));
    expect(res.status).toBe(200);
    const made = vi.mocked(newCard.createCardFromBody).mock.calls[0]?.[0] as { prompt: string; title: string; cwd: string };
    expect(made.title).toBe("Design an agent for app");
    expect(made.cwd).toBe("/dev/app");
    expect(made.prompt).toContain("Help me design an agent for app that triages GitHub issues");
    expect(made.prompt).toContain("create_agent");
  });

  it("writes the brief page as the thread's default show file, and opens it", async () => {
    const res = await designRoute.POST(req("POST", { project: "/dev/app", job: "triages GitHub issues" }));
    expect(res.status).toBe(200);
    const written = vi.mocked(show.writeShowFile).mock.calls[0] as unknown as [string, string];
    expect(written[0]).toBe("c1");
    expect(written[1]).toContain("Design an agent for app");
    expect(written[1]).toContain("triages GitHub issues");
    // It is opened in the card's own pane, so the page is in front of you with the thread.
    expect(show.openShowFile).toHaveBeenCalledWith("c1");
  });

  it("is refused when the guard denies", async () => {
    state.elevatedDenied = true;
    const res = await designRoute.POST(req("POST", { project: "/dev/app", job: "triages GitHub issues" }));
    expect(res.status).toBe(403);
    expect(newCard.createCardFromBody).not.toHaveBeenCalled();
  });

  it("answers 400 when the project wasn't said", async () => {
    const res = await designRoute.POST(req("POST", { job: "triages GitHub issues" }));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toContain("which project");
    expect(newCard.createCardFromBody).not.toHaveBeenCalled();
  });

  it("answers 400 when the job wasn't said", async () => {
    const res = await designRoute.POST(req("POST", { project: "/dev/app", job: "  " }));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toContain("what the agent is for");
    expect(newCard.createCardFromBody).not.toHaveBeenCalled();
  });
});
