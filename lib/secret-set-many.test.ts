import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<Result>;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: (name: string, _description: string, _schema: unknown, handler: Handler) => ({ name, handler }),
}));
vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:4567");
vi.mock("./shell-token", () => ({ shellToken: () => "tok" }));
const { setValuesTool, SET_VALUES_PROMPT, SET_VALUES_ON_WORKER } = await import("./secret-set-many");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const reply = (data: Record<string, unknown>) => fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(data) });
const sent = () => {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, body: JSON.parse(init.body as string) as Record<string, unknown> };
};
const t = setValuesTool(() => "/proj") as unknown as { name: string; handler: Handler };
const said = (r: Result) => r.content[0]?.text;
const A = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const B = "f0e1d2c3b4a5968778695a4b3c2d1e0f";
// Nothing the thread reads back may hold a value it passed in.
const clean = (r: Result) => expect(JSON.stringify(r)).not.toMatch(new RegExp(`${A}|${B}`));

beforeEach(() => fetchMock.mockReset());

describe("set_values", () => {
  it("sends every secret in one request, defaulting each one's environment to the call's", async () => {
    reply({
      ok: true,
      label: "aimhuge/weft",
      added: [{ name: "SIGNING", environment: "production" }],
      set: [{ name: "CRON", environment: "development" }],
      replaced: [{ name: "PRICE", environment: "production" }],
      filled: [],
    });
    const r = await t.handler({
      environment: "production",
      secrets: [
        { name: "SIGNING", value: A },
        { name: "CRON", value: B, environment: "development" },
        { name: "PRICE", value: "price_1", replace: true },
      ],
    });
    expect(t.name).toBe("set_values");
    expect(sent()).toEqual({
      url: "http://127.0.0.1:4567/secrets/set-many",
      body: {
        folder: "/proj",
        secrets: [
          { name: "SIGNING", value: A, environment: "production" },
          { name: "CRON", value: B, environment: "development" },
          { name: "PRICE", value: "price_1", environment: "production", replace: true },
        ],
      },
    });
    expect([r.isError, said(r)]).toEqual([
      false,
      "Added to the aimhuge/weft vault: SIGNING (production).\nSet in the aimhuge/weft vault: CRON (development).\nReplaced in the aimhuge/weft vault: PRICE (production).",
    ]);
    clean(r);
  });

  it("says which were left alone, and is an error when nothing was written", async () => {
    reply({ ok: true, label: "o/r", added: [{ name: "A", environment: "development" }], filled: [{ name: "B", environment: "development" }] });
    const some = await t.handler({ secrets: [{ name: "A", value: A }, { name: "B", value: B, replace: false }], project: "/other" });
    expect(sent().body).toEqual({ folder: "/other", secrets: [{ name: "A", value: A, environment: "development" }, { name: "B", value: B, environment: "development" }] });
    expect(some.isError).toBe(false);
    expect(said(some)).toContain("Left alone, since they already have a value: B (development). Pass replace: true");
    clean(some);

    reply({ label: "o/r", filled: [{ name: "B", environment: "development" }] });
    expect((await t.handler({ secrets: [{ name: "B", value: B }] })).isError).toBe(true);
  });

  it("names every secret when the user says no, without a value", async () => {
    reply({ denied: true, label: "o/r", filled: [] });
    const r = await t.handler({ secrets: [{ name: "A", value: A }, { name: "B", value: B, environment: "preview" }] });
    expect([r.isError, said(r)]).toEqual([true, "The user didn't approve storing A (development), B (preview). Nothing was written. Ask before trying again."]);
    clean(r);
    expect(SET_VALUES_PROMPT).toContain("one Touch ID");
  });

  it("proves the card it's for, so a grant that names writes can stand in for the Touch ID", async () => {
    reply({ ok: true, label: "o/r", added: [{ name: "A", environment: "development" }] });
    const carded = setValuesTool(() => "/proj", () => "c1") as unknown as { handler: Handler };
    await carded.handler({ secrets: [{ name: "A", value: A }] });
    const { card, cardSig } = sent().body;
    expect(card).toBe("c1");
    expect(cardSig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sends a card on a worker to set_value instead, since the vault is the owner's Mac's", async () => {
    vi.stubEnv("WEFT_WORKER", "1");
    vi.stubEnv("WEFT_SHELL_URL", "");
    try {
      const r = await t.handler({ secrets: [{ name: "A", value: A }] });
      expect([r.isError, said(r)]).toEqual([true, SET_VALUES_ON_WORKER]);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.stubEnv("WEFT_WORKER", "");
      vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:4567");
    }
  });
});
