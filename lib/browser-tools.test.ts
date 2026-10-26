import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<Result>;

// Capture the server options and each tool's handler so the tests can call them directly.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: (options: { name: string; alwaysLoad?: boolean; tools: Array<{ name: string; handler: Handler }> }) => options,
  tool: (name: string, _description: string, _schema: unknown, handler: Handler) => ({ name, handler }),
}));

// The shell URL and token are read when the module loads.
vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:4567");
vi.mock("./shell-token", () => ({ shellToken: () => "tok" }));
// Site notes for the opened page (lib/site-notes-read.ts); none unless a test says so.
const siteNotes = vi.hoisted(() => vi.fn(() => Promise.resolve("")));
vi.mock("./site-notes-live", () => ({ siteNotesForUrl: siteNotes }));
const bt = await import("./browser-tools");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const reply = (data: Record<string, unknown>, ok = true, statusText = "Bad Request") =>
  fetchMock.mockResolvedValueOnce({ ok, statusText, json: () => Promise.resolve(data) });
const sent = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string) as Record<string, unknown> };
};

let card: string | undefined = "c1";
const server = bt.browserMcpServer(() => card) as unknown as { name: string; alwaysLoad: boolean; tools: Array<{ name: string; handler: Handler }> };
const run = (name: string, args: Record<string, unknown> = {}) => server.tools.find((t) => t.name === name)!.handler(args);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-browser-tools-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => {
  fetchMock.mockReset();
  card = "c1";
});

describe("BROWSER_PROMPT", () => {
  it("asks a long task to put its plan in the pane in its first tool calls", () => {
    expect(bt.BROWSER_PROMPT).toMatch(/long task[^.]*write your plan to a page and open it in one of your first tool calls/);
  });

  it("tells the thread to carry the plan out in the same turn, not stop at it", () => {
    expect(bt.BROWSER_PROMPT).toContain("carry the plan out in the same turn");
    expect(bt.BROWSER_PROMPT).toContain("not a stopping point");
  });

  it("puts pages in ~/.weft/show, which survives a reboot, not /tmp", () => {
    const showDir = path.join(process.env.WEFT_DATA!, "show");
    expect(bt.BROWSER_PROMPT).toContain(`${showDir}/<topic>.html`);
    expect(bt.BROWSER_PROMPT).toContain(`${showDir}/<topic>/index.html`);
    // The test sandbox sits under os.tmpdir() (/tmp on Linux CI), so look past the show dir itself:
    // nothing else in the prompt may point pages at a temp dir.
    const rest = bt.BROWSER_PROMPT.split(showDir).join("<show>");
    expect(rest).not.toContain("/tmp");
    expect(rest).not.toContain(os.tmpdir());
  });
});

describe("talking to the shell", () => {
  it("POSTs JSON with the bearer token to the shell's route", async () => {
    reply({ url: "https://a.test" });
    await bt.paneUrl("k1");
    const { url, init, body } = sent();
    expect(url).toBe("http://127.0.0.1:4567/browser/url");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ authorization: "Bearer tok", "content-type": "application/json" });
    expect(body).toEqual({ key: "k1" });
  });

  it("throws the shell's error, or the status text when it gives none", async () => {
    reply({ error: "no such pane" }, false);
    await expect(bt.openInPane("https://a.test", "k")).rejects.toThrow("no such pane");
    reply({}, false, "Not Found");
    await expect(bt.openInPane("https://a.test", "k")).rejects.toThrow("Not Found");
  });
});

describe("paneUrl", () => {
  it("is the page's url, or \"\" when the card has no page yet", async () => {
    reply({ url: "https://a.test/x" });
    expect(await bt.paneUrl("k")).toBe("https://a.test/x");
    reply({});
    expect(await bt.paneUrl("k")).toBe("");
  });

  it("is undefined when the shell can't say", async () => {
    reply({ error: "unknown route" }, false);
    expect(await bt.paneUrl("k")).toBeUndefined();
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await bt.paneUrl("k")).toBeUndefined();
  });
});

describe("paneThumb", () => {
  it("decodes the JPEG the shell sends", async () => {
    reply({ jpg: Buffer.from("jpeg bytes").toString("base64") });
    expect((await bt.paneThumb("k"))?.toString()).toBe("jpeg bytes");
    expect(sent().url).toMatch(/\/browser\/thumb$/);
  });

  it("is undefined with no picture or no shell", async () => {
    reply({ jpg: "" });
    expect(await bt.paneThumb("k")).toBeUndefined();
    reply({ jpg: 42 });
    expect(await bt.paneThumb("k")).toBeUndefined();
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await bt.paneThumb("k")).toBeUndefined();
  });
});

describe("openInPane", () => {
  it("opens the url in the card's browser", async () => {
    reply({ url: "https://a.test", title: "A" });
    await bt.openInPane("https://a.test", "c9");
    expect(sent()).toMatchObject({ url: "http://127.0.0.1:4567/browser/open", body: { url: "https://a.test", key: "c9" } });
  });
});

describe("browserMcpServer", () => {
  it("is the always-loaded browser server with the pane and act tools", () => {
    expect(server.name).toBe("browser");
    expect(server.alwaysLoad).toBe(true);
    expect(server.tools.map((t) => t.name)).toEqual([
      "open_url",
      "read_page",
      "screenshot",
      "snapshot",
      "click",
      "hover",
      "type_text",
      "press_key",
      "select_option",
      "scroll",
      "wait_for",
      "set_viewport",
      "console_logs",
      "network_errors",
    ]);
  });

  it("open_url adds the site notes for the page it opened", async () => {
    reply({ url: "https://supabase.com/dashboard", title: "Supabase" });
    siteNotes.mockResolvedValueOnce("Site notes for supabase.com.");
    const result = await run("open_url", { url: "https://supabase.com/dashboard" });
    expect(result.content[0]?.text).toBe("Opened https://supabase.com/dashboard — Supabase\n\nSite notes for supabase.com.");
    expect(siteNotes).toHaveBeenLastCalledWith("c1", "https://supabase.com/dashboard");
  });

  it("open_url opens the page in this card's pane and names it", async () => {
    reply({ url: "https://a.test/", title: "A page" });
    expect(await run("open_url", { url: "https://a.test" })).toEqual({ content: [{ type: "text", text: "Opened https://a.test/ — A page" }], isError: false });
    expect(sent().body).toEqual({ url: "https://a.test", key: "c1" });
  });

  it("reads the card id when the tool runs, so a spare that becomes a card drives that card's pane", async () => {
    card = undefined;
    reply({ url: "u", title: "t" });
    await run("open_url", { url: "u" });
    expect(sent(0).body.key).toBeUndefined();
    card = "taken-over";
    reply({ url: "u", title: "t" });
    await run("open_url", { url: "u" });
    expect(sent(1).body.key).toBe("taken-over");
  });

  it("read_page returns the url, title and visible text", async () => {
    reply({ url: "https://a.test", title: "A", text: "Hello world" });
    const r = await run("read_page");
    expect(r.content[0]!.text).toBe("URL: https://a.test\nTitle: A\n\nHello world");
    expect(sent()).toMatchObject({ url: expect.stringMatching(/\/browser\/text$/) as unknown, body: { key: "c1" } });
  });

  it("click and type_text report success, or the error the shell raises when nothing matches", async () => {
    reply({ ok: true });
    expect((await run("click", { selector: "#go" })).content[0]!.text).toBe("Clicked #go");
    expect(sent(0).body).toEqual({ selector: "#go", key: "c1" });
    reply({ error: "No element matches #nope" }, false);
    expect(await run("click", { selector: "#nope" })).toMatchObject({ isError: true, content: [{ text: "No element matches #nope" }] });

    reply({ ok: true });
    expect((await run("type_text", { selector: "input", text: "hi" })).content[0]!.text).toBe("Typed into input");
    expect(sent(2).body).toEqual({ selector: "input", text: "hi", key: "c1" });
    reply({ error: "No element matches #x" }, false);
    expect(await run("type_text", { selector: "#x", text: "hi" })).toMatchObject({ isError: true, content: [{ text: "No element matches #x" }] });
  });

  it("turns a shell failure into an error result instead of throwing", async () => {
    reply({ error: "pane closed" }, false);
    expect(await run("read_page")).toEqual({ content: [{ type: "text", text: "pane closed" }], isError: true });
    fetchMock.mockRejectedValueOnce("socket hang up");
    expect(await run("click", { selector: "a" })).toEqual({ content: [{ type: "text", text: "socket hang up" }], isError: true });
  });
});

describe("the screenshot tool", () => {
  const png = Buffer.from("png bytes").toString("base64");

  it("returns the image alone by default", async () => {
    reply({ png });
    expect(await run("screenshot")).toEqual({ content: [{ type: "image", data: png, mimeType: "image/png" }] });
    expect(sent().body).toEqual({ key: "c1" });
  });

  it("saves to an absolute path, adding .png when missing and creating folders", async () => {
    const file = path.join(tmp, "setup", "step-1");
    reply({ png });
    const r = await run("screenshot", { save_to: file });
    expect(r.content[1]).toEqual({ type: "text", text: `Saved to ${file}.png` });
    expect(fs.readFileSync(`${file}.png`, "utf8")).toBe("png bytes");

    const upper = path.join(tmp, "Shot.PNG");
    reply({ png });
    expect((await run("screenshot", { save_to: upper })).content[1]!.text).toBe(`Saved to ${upper}`);
    expect(fs.existsSync(upper)).toBe(true);
  });

  it("refuses a relative save_to", async () => {
    reply({ png });
    expect(await run("screenshot", { save_to: "shots/a.png" })).toEqual({
      content: [{ type: "text", text: "save_to must be an absolute path, not shots/a.png" }],
      isError: true,
    });
  });

  it("passes highlight on, and says so when it matched nothing", async () => {
    reply({ png, found: true });
    const hit = await run("screenshot", { highlight: "#buy" });
    expect(sent(0).body).toEqual({ key: "c1", highlight: "#buy" });
    expect(hit.content).toHaveLength(1);
    reply({ png, found: false });
    const miss = await run("screenshot", { highlight: "#gone" });
    expect(miss.content[1]).toEqual({ type: "text", text: "No element matches #gone; nothing was boxed." });
  });
});

describe("outside the desktop app", () => {
  it("says the pane needs the desktop app, and the helpers fall back quietly", async () => {
    vi.resetModules();
    vi.stubEnv("WEFT_SHELL_URL", "");
    const bare = await import("./browser-tools");
    const s = bare.browserMcpServer(() => "c1") as unknown as typeof server;
    const r = await s.tools.find((t) => t.name === "read_page")!.handler({});
    expect(r).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/only exists in the desktop app/) as unknown }] });
    expect(await bare.paneUrl("k")).toBeUndefined();
    expect(await bare.paneThumb("k")).toBeUndefined();
    await expect(bare.openInPane("u", "k")).rejects.toThrow(/desktop app/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
