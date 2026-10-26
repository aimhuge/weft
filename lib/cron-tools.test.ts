import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

// The board MCP's cron tools (lib/cron-tools.ts): a thread can put itself, or a fresh prompt, on a
// schedule. The tools come from the SDK's tool(), so the test captures them and calls each handler.

interface CapturedTool {
  name: string;
  description: string;
  handler: (args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[]; isError?: true }>;
}

const captures: CapturedTool[] = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: (name: string, description: string, _schema: unknown, handler: CapturedTool["handler"]) => {
    captures.push({ name, description, handler });
    return { name, description, handler };
  },
}));

const cards = new Map<string, Card>();
vi.mock("./store", () => ({
  getCard: (id: string) => cards.get(id),
  DATA_DIR: "/tmp/weft-cron-tools-test",
}));

// The card a run makes (lib/cron-run.ts returns one).
type RunCard = { id: string; cronRun?: number; title: string };
const runCron = vi.hoisted(() => vi.fn<(id: string, now?: number) => Promise<RunCard>>());
vi.mock("./cron-run", () => ({ runCron }));

vi.mock("./folders", () => ({ resolveFolder: () => "/tmp/project" }));
vi.mock("./settings", () => ({ defaultPermissionMode: () => "default" }));

const { cronTools, cronLine } = await import("./cron-tools");
const { createCron } = await import("./crons");
const { listCrons } = await import("./cron-store");

const cronsFile = () => path.join("/tmp/weft-cron-tools-test", "crons.json");

const textOf = (r: { content: { type: "text"; text: string }[] }) => r.content.map((c) => c.text).join("\n");

function capturedTool(name: string): CapturedTool {
  const t = captures.find((x) => x.name === name);
  if (!t) throw new Error(`No tool ${name} captured. Captured: ${captures.map((x) => x.name).join(", ")}`);
  return t;
}

const card = (id: string, over: Partial<Card> = {}): Card => {
  const c: Card = {
    id,
    title: `Card ${id}`,
    prompt: "p",
    cwd: "/tmp/project",
    backend: "claude",
    permissionMode: "default",
    column: "backlog",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
  cards.set(id, c);
  return c;
};

beforeEach(() => {
  captures.length = 0;
  cards.clear();
  fs.rmSync(cronsFile(), { force: true });
  vi.clearAllMocks();
  cronTools(() => undefined);
});

describe("cronTools", () => {
  it("makes the five cron tools", () => {
    expect(captures.map((t) => t.name)).toEqual(["create_cron", "list_crons", "update_cron", "delete_cron", "run_cron_now"]);
  });

  it("describes each tool", () => {
    for (const t of captures) expect(t.description.length).toBeGreaterThan(10);
  });
});

describe("create_cron", () => {
  it("makes a fresh cron and says what it made", async () => {
    const r = await capturedTool("create_cron").handler({ prompt: "do the thing", schedule: "0 9 * * *" });
    const text = textOf(r);
    expect(r.isError).toBeUndefined();
    expect(text).toContain("Created cron ");
    expect(text).toContain("every day at 9:00");
    expect(text).toContain("next ");
    expect(listCrons()).toHaveLength(1);
  });

  it("takes the thread's card as the source by default, and forks it", async () => {
    card("c1", { title: "Source", sessionId: "sess-1" });
    captures.length = 0;
    cronTools(() => "c1");
    const r = await capturedTool("create_cron").handler({ prompt: "p", schedule: "0 9 * * *" });
    expect(r.isError).toBeUndefined();
    const cron = listCrons()[0]!;
    expect(cron.sourceId).toBe("c1");
    expect(cron.mode).toBe("fork");
    expect(cron.by).toBe("thread");
  });

  it("takes the card it was given over the thread's own", async () => {
    card("c1", { sessionId: "sess-1" });
    card("c2", { sessionId: "sess-2" });
    captures.length = 0;
    cronTools(() => "c1");
    await capturedTool("create_cron").handler({ prompt: "p", schedule: "0 9 * * *", card_id: "c2" });
    expect(listCrons()[0]!.sourceId).toBe("c2");
  });

  it("makes a fresh cron when the card is the copilot", async () => {
    card("co", { role: "copilot" });
    captures.length = 0;
    cronTools(() => "co");
    await capturedTool("create_cron").handler({ prompt: "p", schedule: "0 9 * * *" });
    const cron = listCrons()[0]!;
    expect(cron.sourceId).toBeUndefined();
    expect(cron.mode).toBe("fresh");
  });

  it("makes a fresh cron when the card is not there", async () => {
    captures.length = 0;
    cronTools(() => "gone");
    await capturedTool("create_cron").handler({ prompt: "p", schedule: "0 9 * * *" });
    expect(listCrons()[0]!.mode).toBe("fresh");
  });

  it("takes the mode, name and folder it was given", async () => {
    await capturedTool("create_cron").handler({ prompt: "p", schedule: "0 9 * * *", mode: "fresh", name: "Named", folder: "/tmp" });
    const cron = listCrons()[0]!;
    expect(cron.mode).toBe("fresh");
    expect(cron.name).toBe("Named");
    expect(cron.cwd).toBe("/tmp/project");
  });

  it("says what went wrong instead of throwing", async () => {
    const r = await capturedTool("create_cron").handler({ prompt: "  ", schedule: "0 9 * * *" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("Write what each run should do.");
  });

  it("says what went wrong when the schedule is no cron", async () => {
    const r = await capturedTool("create_cron").handler({ prompt: "p", schedule: "0 9 *" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("five fields");
  });
});

describe("list_crons", () => {
  it("says there are none yet", async () => {
    const r = await capturedTool("list_crons").handler({});
    expect(textOf(r)).toBe("No crons yet.");
  });

  it("lists each cron on a line", async () => {
    await capturedTool("create_cron").handler({ prompt: "p", schedule: "0 9 * * *", name: "One" });
    await capturedTool("create_cron").handler({ prompt: "q", schedule: "0 10 * * *", name: "Two" });
    const r = await capturedTool("list_crons").handler({});
    const lines = textOf(r).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("One");
    expect(lines[1]).toContain("Two");
  });
});

describe("update_cron", () => {
  it("changes the cron and says how it reads now", async () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", name: "One" });
    const r = await capturedTool("update_cron").handler({ id: cron.id, prompt: "q", schedule: "0 10 * * *", name: "Two", enabled: false });
    expect(r.isError).toBeUndefined();
    const text = textOf(r);
    expect(text).toContain("Two");
    expect(text).toContain("off");
    expect(listCrons()[0]!.prompt).toBe("q");
    expect(listCrons()[0]!.expr).toBe("0 10 * * *");
  });

  it("changes only what it was given", async () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", name: "One" });
    await capturedTool("update_cron").handler({ id: cron.id, name: "Two" });
    const after = listCrons()[0]!;
    expect(after.name).toBe("Two");
    expect(after.prompt).toBe("p");
    expect(after.expr).toBe("0 9 * * *");
  });

  it("says what went wrong for a cron that isn't there", async () => {
    const r = await capturedTool("update_cron").handler({ id: "nope", name: "x" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("No such cron.");
  });
});

describe("delete_cron", () => {
  it("takes the cron away and says so", async () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" });
    const r = await capturedTool("delete_cron").handler({ id: cron.id });
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toBe(`Deleted cron ${cron.id}.`);
    expect(listCrons()).toHaveLength(0);
  });

  it("says what went wrong for a cron that isn't there", async () => {
    const r = await capturedTool("delete_cron").handler({ id: "nope" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("No such cron.");
  });
});

describe("run_cron_now", () => {
  it("fires the cron and says which card it made", async () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" });
    runCron.mockResolvedValue({ id: "card-9", cronRun: 3, title: "Digest" });
    const r = await capturedTool("run_cron_now").handler({ id: cron.id });
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toBe("Started run 3 as card card-9: Digest");
    expect(runCron).toHaveBeenCalledWith(cron.id);
  });

  it("says what went wrong when the run can't start", async () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" });
    runCron.mockRejectedValue(new Error("No such cron."));
    const r = await capturedTool("run_cron_now").handler({ id: cron.id });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("No such cron.");
  });

  it("says what went wrong when the failure isn't an Error", async () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" });
    runCron.mockRejectedValue("plain string");
    const r = await capturedTool("run_cron_now").handler({ id: cron.id });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("plain string");
  });
});

describe("cronLine", () => {
  it("reads the cron: id, name, schedule, mode, on or off and the next run", () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", name: "One" });
    const line = cronLine(cron);
    expect(line).toContain(cron.id);
    expect(line).toContain("One");
    expect(line).toContain("every day at 9:00");
    expect(line).toContain("0 9 * * *");
    expect(line).toContain("fresh");
    expect(line).toContain("on");
    expect(line).toContain("next ");
  });

  it("says there is no next run when there isn't one", () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *", enabled: false });
    expect(cronLine(cron)).toContain("no next run");
  });

  it("says the last run and its card", () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" });
    const ran = { ...cron, runs: [{ cardId: "card-1", n: 2, at: 1 }] };
    expect(cronLine(ran)).toContain("last run 2: card card-1");
  });

  it("says the last run failed", () => {
    const cron = createCron({ prompt: "p", expr: "0 9 * * *" });
    const ran = { ...cron, runs: [{ cardId: "", n: 1, at: 1, error: "boom" }] };
    expect(cronLine(ran)).toContain("last run failed: boom");
  });
});
