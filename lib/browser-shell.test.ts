import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./shell-token", () => ({ shellToken: () => "tok" }));
vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:4567");
const shell = await import("./browser-shell");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const reply = (data: Record<string, unknown>, ok = true, statusText = "Bad Request") =>
  fetchMock.mockResolvedValueOnce({ ok, statusText, json: () => Promise.resolve(data) });
const sent = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string) as Record<string, unknown> };
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("shell", () => {
  it("POSTs JSON with the bearer token to the shell's route", async () => {
    reply({ url: "https://a.test" });
    expect(await shell.shell("/browser/url", { key: "k1" })).toEqual({ url: "https://a.test" });
    const { url, init, body } = sent();
    expect(url).toBe("http://127.0.0.1:4567/browser/url");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ authorization: "Bearer tok", "content-type": "application/json" });
    expect(body).toEqual({ key: "k1" });
  });

  it("sends an empty body when there is none", async () => {
    reply({ ok: true });
    await shell.shell("/browser/url");
    expect(sent().body).toEqual({});
  });

  it("throws the shell's error, or the status text when it gives none", async () => {
    reply({ error: "no such pane" }, false);
    await expect(shell.shell("/browser/url")).rejects.toThrow("no such pane");
    reply({}, false, "Not Found");
    await expect(shell.shell("/browser/url")).rejects.toThrow("Not Found");
  });
});

describe("text", () => {
  it("is a text result, flagged as an error when it says so", () => {
    expect(shell.text("hello")).toEqual({ content: [{ type: "text", text: "hello" }], isError: false });
    expect(shell.text("bad", true)).toEqual({ content: [{ type: "text", text: "bad" }], isError: true });
  });
});

describe("attempt", () => {
  it("passes a good result through", async () => {
    expect(await shell.attempt(() => Promise.resolve(shell.text("fine")))).toEqual({
      content: [{ type: "text", text: "fine" }],
      isError: false,
    });
  });

  it("turns a throw into an error result", async () => {
    const r = await shell.attempt(() => Promise.reject(new Error("pane closed")));
    expect(r).toEqual({ content: [{ type: "text", text: "pane closed" }], isError: true });
  });

  it("says a thrown non-error as it came", async () => {
    // A socket failure that isn't an Error: the shell still says what it threw.
    const thrown: unknown = "socket hang up";
    const r = await shell.attempt(async () => {
      await Promise.resolve();
      throw thrown;
    });
    expect(r).toEqual({ content: [{ type: "text", text: "socket hang up" }], isError: true });
  });
});

describe("outside the desktop app", () => {
  it("says the pane needs the desktop app, and doesn't call out", async () => {
    vi.resetModules();
    vi.stubEnv("WEFT_SHELL_URL", "");
    const bare = await import("./browser-shell");
    await expect(bare.shell("/browser/url")).rejects.toThrow(/only exists in the desktop app/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
