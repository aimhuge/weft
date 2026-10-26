import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<Result>;

// Capture each tool's handler so the tests can call them directly.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: (name: string, _description: string, _schema: unknown, handler: Handler) => ({ name, handler }),
}));

// The shell URL and token are read when the module loads.
vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:4567");
vi.mock("./shell-token", () => ({ shellToken: () => "tok" }));
const act = await import("./browser-act-tools");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const reply = (data: Record<string, unknown>, ok = true, statusText = "Bad Request") =>
  fetchMock.mockResolvedValueOnce({ ok, statusText, json: () => Promise.resolve(data) });
const sent = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string) as Record<string, unknown> };
};

let card: string | undefined = "c1";
const tools = act.actTools(() => card) as unknown as Array<{ name: string; handler: Handler }>;
const run = (name: string, args: Record<string, unknown> = {}) => {
  const tool = tools.find((t) => t.name === name)!;
  return tool.handler(args);
};

beforeEach(() => {
  fetchMock.mockReset();
  card = "c1";
});

describe("the act tools", () => {
  it("are the pane's page tools, in order", () => {
    expect(tools.map((t) => t.name)).toEqual([
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

  it("send the card's id as the key, and read it when the tool runs", async () => {
    reply({ url: "u", title: "t", text: "body" });
    await run("snapshot");
    expect(sent(0).body).toEqual({ key: "c1" });

    card = undefined;
    reply({ url: "u", title: "t", text: "body" });
    await run("snapshot");
    expect(sent(1).body.key).toBeUndefined();

    card = "taken-over";
    reply({ url: "u", title: "t", text: "body" });
    await run("snapshot");
    expect(sent(2).body.key).toBe("taken-over");
  });
});

describe("snapshot", () => {
  it("returns the url, title and the outline of the page", async () => {
    reply({ url: "https://a.test", title: "A page", text: "- button \"Buy\" [ref=e42]" });
    const r = await run("snapshot");
    expect(r.content[0]!.text).toBe('URL: https://a.test\nTitle: A page\n\n- button "Buy" [ref=e42]');
    expect(sent().url).toMatch(/\/browser\/snapshot$/);
  });

  it("says when elements didn't fit", async () => {
    reply({ url: "u", title: "t", text: "- a", dropped: 12 });
    const r = await run("snapshot");
    expect(r.content[0]!.text).toContain("… 12 more elements didn't fit; scroll or use read_page for the rest.");
  });

  it("says nothing about dropped elements when none were dropped", async () => {
    reply({ url: "u", title: "t", text: "- a", dropped: 0 });
    const r = await run("snapshot");
    expect(r.content[0]!.text).not.toContain("more elements");
  });
});

describe("click", () => {
  it("clicks by ref and names it", async () => {
    reply({});
    const r = await run("click", { ref: "e42", double: true });
    expect(r.content[0]!.text).toBe("Clicked e42");
    expect(sent().url).toMatch(/\/browser\/click$/);
    expect(sent().body).toEqual({ ref: "e42", double: true, key: "c1" });
  });

  it("clicks by selector when there's no ref", async () => {
    reply({});
    const r = await run("click", { selector: "#go" });
    expect(r.content[0]!.text).toBe("Clicked #go");
    expect(sent().body).toEqual({ selector: "#go", key: "c1" });
  });

  it("names nothing when given neither", async () => {
    reply({});
    expect((await run("click")).content[0]!.text).toBe("Clicked ");
  });

  it("comes back as an error when the shell says nothing matched", async () => {
    reply({ error: "No element matches #nope" }, false);
    expect(await run("click", { selector: "#nope" })).toEqual({
      content: [{ type: "text", text: "No element matches #nope" }],
      isError: true,
    });
  });
});

describe("hover", () => {
  it("hovers over the element and names it", async () => {
    reply({});
    const r = await run("hover", { ref: "e7" });
    expect(r.content[0]!.text).toBe("Hovering over e7");
    expect(sent().url).toMatch(/\/browser\/hover$/);
    expect(sent().body).toEqual({ ref: "e7", key: "c1" });
  });
});

describe("type_text", () => {
  it("types into the field and names it", async () => {
    reply({});
    const r = await run("type_text", { ref: "e3", text: "hello" });
    expect(r.content[0]!.text).toBe("Typed into e3");
    expect(sent().url).toMatch(/\/browser\/type$/);
    expect(sent().body).toEqual({ ref: "e3", text: "hello", key: "c1" });
  });

  it("says it pressed Enter when asked to submit", async () => {
    reply({});
    const r = await run("type_text", { selector: "#q", text: "hi", submit: true });
    expect(r.content[0]!.text).toBe("Typed into #q and pressed Enter");
    expect(sent().body).toEqual({ selector: "#q", text: "hi", submit: true, key: "c1" });
  });
});

describe("press_key", () => {
  it("presses the key or combo", async () => {
    reply({});
    const r = await run("press_key", { keys: "Shift+Tab" });
    expect(r.content[0]!.text).toBe("Pressed Shift+Tab");
    expect(sent().url).toMatch(/\/browser\/press$/);
    expect(sent().body).toEqual({ keys: "Shift+Tab", key: "c1" });
  });

  it("focuses an element first when given a ref", async () => {
    reply({});
    await run("press_key", { keys: "Enter", ref: "e9" });
    expect(sent().body).toEqual({ keys: "Enter", ref: "e9", key: "c1" });
  });
});

describe("select_option", () => {
  it("names the options it picked", async () => {
    reply({ picked: ["small", "red"] });
    const r = await run("select_option", { ref: "e5", values: ["small", "red"] });
    expect(r.content[0]!.text).toBe("Selected small, red");
    expect(sent().url).toMatch(/\/browser\/select$/);
    expect(sent().body).toEqual({ ref: "e5", values: ["small", "red"], key: "c1" });
  });
});

describe("scroll", () => {
  it("scrolls the element into view", async () => {
    reply({ scrolled: "e12" });
    const r = await run("scroll", { ref: "e12" });
    expect(r.content[0]!.text).toBe("Scrolled e12 into view");
    expect(sent().url).toMatch(/\/browser\/scroll$/);
    expect(sent().body).toEqual({ ref: "e12", key: "c1" });
  });

  it("scrolls the page down by default, and says where it landed", async () => {
    reply({ scrollY: 1200, height: 4000, viewport: 700 });
    const r = await run("scroll", {});
    expect(r.content[0]!.text).toBe("Scrolled down; now at 1200px of 4000px (700px visible)");
    expect(sent().body).toEqual({ key: "c1" });
  });

  it("scrolls the way it's told", async () => {
    reply({ scrollY: 0, height: 4000, viewport: 700 });
    const r = await run("scroll", { direction: "right", amount: 200 });
    expect(r.content[0]!.text).toBe("Scrolled right; now at 0px of 4000px (700px visible)");
    expect(sent().body).toEqual({ direction: "right", amount: 200, key: "c1" });
  });
});

describe("wait_for", () => {
  it("waits and says how long it took, renaming timeout_ms to timeout", async () => {
    reply({ waitedMs: 120 });
    const r = await run("wait_for", { text: "Done", timeout_ms: 3000 });
    expect(r.content[0]!.text).toBe("Done after 120ms");
    expect(sent().url).toMatch(/\/browser\/wait$/);
    expect(sent().body).toEqual({ text: "Done", timeout: 3000, key: "c1" });
  });

  it("waits for text to go, or for a selector", async () => {
    reply({ waitedMs: 5 });
    await run("wait_for", { gone: "Loading…" });
    expect(sent(0).body).toEqual({ gone: "Loading…", timeout: undefined, key: "c1" });
    reply({ waitedMs: 5 });
    await run("wait_for", { selector: ".ready" });
    expect(sent(1).body).toEqual({ selector: ".ready", timeout: undefined, key: "c1" });
  });
});

describe("set_viewport", () => {
  it("reports the new size of the page", async () => {
    reply({ width: 390, height: 844 });
    const r = await run("set_viewport", { size: "phone" });
    expect(r.content[0]!.text).toBe("The page now lays out at 390×844");
    expect(sent().url).toMatch(/\/browser\/viewport$/);
    expect(sent().body).toEqual({ size: "phone", key: "c1" });
  });

  it("takes a width and height too", async () => {
    reply({ width: 800, height: 600 });
    await run("set_viewport", { width: 800, height: 600 });
    expect(sent().body).toEqual({ width: 800, height: 600, key: "c1" });
  });
});

describe("console_logs", () => {
  it("lists the messages, with where they happened when the shell says", async () => {
    reply({ entries: [{ level: "error", text: "Boom", at: "app.js:12" }, { level: "warn", text: "Slow" }] });
    const r = await run("console_logs", { level: "all" });
    expect(r.content[0]!.text).toBe("[error] Boom  (app.js:12)\n[warn] Slow");
    expect(sent().url).toMatch(/\/browser\/console$/);
    expect(sent().body).toEqual({ level: "all", key: "c1" });
  });

  it("says nothing is in the console when there is nothing", async () => {
    reply({ entries: [] });
    expect((await run("console_logs", { level: "all" })).content[0]!.text).toBe("Nothing in the console since this page loaded.");
  });

  it("says there are no errors when there are none", async () => {
    reply({ entries: [] });
    expect((await run("console_logs", { level: "error" })).content[0]!.text).toBe("No errors since this page loaded.");
  });

  it("says there are no errors or warnings by default", async () => {
    reply({ entries: [] });
    expect((await run("console_logs")).content[0]!.text).toBe("No errors or warnings since this page loaded.");
    expect(sent().body).toEqual({ key: "c1" });
  });

  it("treats entries that aren't a list as none at all", async () => {
    reply({ entries: "nope" });
    expect((await run("console_logs")).content[0]!.text).toBe("No errors or warnings since this page loaded.");
  });
});

describe("network_errors", () => {
  it("lists a failed request with its status", async () => {
    reply({ entries: [{ status: 404, method: "GET", url: "https://a.test/missing" }] });
    const r = await run("network_errors");
    expect(r.content[0]!.text).toBe("404 GET https://a.test/missing");
    expect(sent().url).toMatch(/\/browser\/network$/);
    expect(sent().body).toEqual({ key: "c1" });
  });

  it("lists a request that failed outright, with its error", async () => {
    reply({ entries: [{ method: "POST", url: "https://a.test/api", type: "xhr", error: "net::ERR_CONNECTION_REFUSED" }] });
    const r = await run("network_errors");
    expect(r.content[0]!.text).toBe("failed POST https://a.test/api (xhr): net::ERR_CONNECTION_REFUSED");
  });

  it("says no requests failed when none did", async () => {
    reply({ entries: [] });
    expect((await run("network_errors")).content[0]!.text).toBe("No failed requests since this page loaded.");
  });

  it("treats entries that aren't a list as none at all", async () => {
    reply({ entries: 42 });
    expect((await run("network_errors")).content[0]!.text).toBe("No failed requests since this page loaded.");
  });
});
