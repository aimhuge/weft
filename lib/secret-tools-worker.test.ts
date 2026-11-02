// The vault's tools on a Weft Worker (docs/architecture/project-hosts.md#the-vault-and-connectors-on-a-worker-t2-as-built):
// list, add_blank, ask_add, set_value and push_to_vercel ask the owner's Mac through lib/worker-vault.ts; fill_field
// and request_access say why they're the Mac's own. Nothing reaches the control server, which a worker doesn't have.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<Result>;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: (options: { tools: Array<{ name: string; handler: Handler }> }) => options,
  tool: (name: string, _description: string, _schema: unknown, handler: Handler) => ({ name, handler }),
}));
vi.mock("./worker-secret-run", () => ({ onWorker: () => true, workerSecretRun: vi.fn(), redactOnWorker: vi.fn() }));
const v = vi.hoisted(() => ({ listOnWorker: vi.fn(), blankOnWorker: vi.fn(), setOnWorker: vi.fn(), pushOnWorker: vi.fn() }));
vi.mock("./worker-vault", () => v);
const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

const st = await import("./secret-tools");
const server = st.secretsMcpServer(() => "w1", () => "/w/proj") as unknown as { tools: Array<{ name: string; handler: Handler }> };
const run = (name: string, args: Record<string, unknown> = {}) => server.tools.find((t) => t.name === name)!.handler(args);
const said = (r: Result) => r.content[0]?.text ?? "";

beforeEach(() => {
  for (const fn of Object.values(v)) fn.mockReset();
  fetchMock.mockReset();
});

describe("the vault's tools on a worker", () => {
  it("lists names from the Mac for the card's project", async () => {
    v.listOnWorker.mockResolvedValueOnce({ label: "o/r", secrets: [{ name: "A", environment: "development", missing: true }] });
    expect(said(await run("list"))).toBe("Secrets in the o/r vault (names only):\n- A (development): blank, no value yet");
    expect(v.listOnWorker).toHaveBeenCalledWith("w1", "/w/proj");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses fill_field and request_access, saying what to do instead", async () => {
    const fill = await run("fill_field", { name: "A", selector: "#k" });
    expect(fill).toMatchObject({ isError: true });
    expect(said(fill)).toBe(st.FILL_ON_WORKER);
    const access = await run("request_access", { why: "setup" });
    expect(said(access)).toBe(st.ACCESS_ON_WORKER);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores a generated value through the Mac", async () => {
    v.setOnWorker.mockResolvedValueOnce({ ok: true, added: true, label: "o/r" });
    expect(said(await run("set_value", { name: "S", value: "v", replace: true }))).toBe("Added S to the o/r vault (development).");
    expect(v.setOnWorker).toHaveBeenCalledWith("w1", "/w/proj", { name: "S", value: "v", environment: "development", replace: true });
  });

  it("pushes through the Mac, and makes a missing name a blank there", async () => {
    v.pushOnWorker.mockResolvedValueOnce({ project: "web", label: "o/r" });
    expect(said(await run("push_to_vercel", { name: "S" }))).toContain("Pushed S (production) from the o/r vault to Vercel project web");
    expect(v.pushOnWorker).toHaveBeenCalledWith("w1", "/w/proj", "S", "production");
    v.pushOnWorker.mockResolvedValueOnce({ missing: true, label: "o/r" });
    v.blankOnWorker.mockResolvedValueOnce({ label: "o/r", filled: [] });
    expect(said(await run("push_to_vercel", { name: "S", environment: "preview" }))).toContain("It's a blank there now");
    expect(v.blankOnWorker).toHaveBeenCalledWith("w1", "/w/proj", ["S"], "preview");
    v.pushOnWorker.mockResolvedValueOnce({ missing: true, label: "o/r" });
    v.blankOnWorker.mockRejectedValueOnce(new Error("no Mac"));
    expect(said(await run("push_to_vercel", { name: "S" }))).toContain("Ask the user to add it with 🔐");
  });

  it("adds blanks on the Mac", async () => {
    v.blankOnWorker.mockResolvedValueOnce({ label: "o/r", filled: ["B"] });
    const r = said(await run("add_blank", { names: ["A", "B"], hint: "Stripe" }));
    expect(r).toContain("A is a blank in the o/r vault (development) now");
    expect(r).toContain("B already has a value there.");
    expect(v.blankOnWorker).toHaveBeenCalledWith("w1", "/w/proj", ["A", "B"], "development", "Stripe");
    v.blankOnWorker.mockResolvedValueOnce({ label: "", filled: [] });
    expect(said(await run("add_blank", { names: ["A"] }))).toContain("in the this vault");
  });

  it("asks for a key by making it a blank on the Mac, for the user to fill there", async () => {
    v.blankOnWorker.mockResolvedValueOnce({ label: "o/r", filled: [] });
    expect(said(await run("ask_add", { name: "K" }))).toBe("K (development) is a blank in the o/r vault on the user's Mac now. This card runs on a Weft Worker, so ask the user to fill it in with 🔐 on their Mac, then end your turn; they'll tell you once it's in.");
    v.blankOnWorker.mockResolvedValueOnce({ label: "", filled: ["K"] });
    const filled = await run("ask_add", { name: "K", environment: "preview" });
    expect(filled.isError).toBe(true);
    expect(said(filled)).toContain("K already has a value in the this vault (preview)");
    v.blankOnWorker.mockResolvedValueOnce({ label: "", filled: [] });
    expect(said(await run("ask_add", { name: "K" }))).toContain("in the this vault on the user's Mac");
  });
});
