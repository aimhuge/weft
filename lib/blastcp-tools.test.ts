import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BlastCP's tools for a thread, relayed through Electron main's sealed sign-in (docs/architecture/blastcp.md#threads).
const shell = vi.hoisted(() => vi.fn());
vi.mock("./browser-shell", () => ({ shell }));

const tools = await import("./blastcp-tools");
const { CALL_TOOL, NOT_CONNECTED, ON_WORKER, RECONNECT, RESTART, blastcpMcpServer, callTool, listTools, saveImages, whyNot } = tools;

const GEN = { name: "generate_image", description: "Make a picture", inputSchema: { type: "object" as const, properties: { prompt: { type: "string" } } } };
const textOf = (r: { content: Array<{ type: string; text?: string }> }) => r.content.map((c) => c.text ?? "").join("\n");

let show: string;
beforeEach(() => {
  shell.mockReset();
  show = fs.mkdtempSync(path.join(os.tmpdir(), "blastcp-show-"));
  vi.stubEnv("WEFT_SHOW_DIR", show);
  vi.stubEnv("WEFT_WORKER", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("listTools", () => {
  it("lists BlastCP's tools and the always-there call", async () => {
    shell.mockResolvedValue({ state: "ok", result: { tools: [GEN, { ...CALL_TOOL, description: "theirs" }] } });
    expect(await listTools()).toEqual([GEN, CALL_TOOL]);
    expect(shell).toHaveBeenCalledWith("/blastcp/mcp", { method: "tools/list", params: {} });
  });

  it("lists only call when BlastCP isn't connected, main can't be reached, or on a worker", async () => {
    shell.mockResolvedValueOnce({ state: "off" });
    expect(await listTools()).toEqual([CALL_TOOL]);
    shell.mockRejectedValueOnce(new Error("The browser pane only exists in the desktop app"));
    expect(await listTools()).toEqual([CALL_TOOL]);
    vi.stubEnv("WEFT_WORKER", "1");
    vi.stubEnv("WEFT_SHELL_URL", "");
    expect(await listTools()).toEqual([CALL_TOOL]);
  });
});

describe("callTool", () => {
  it("forwards a BlastCP tool by its name", async () => {
    shell.mockResolvedValue({ state: "ok", result: { content: [{ type: "text", text: "queued" }] } });
    expect(await callTool("list_posts", { limit: 1 })).toEqual({ content: [{ type: "text", text: "queued" }] });
    expect(shell).toHaveBeenCalledWith("/blastcp/mcp", { method: "tools/call", params: { name: "list_posts", arguments: { limit: 1 } } });
  });

  it("forwards call's tool and arguments, and asks for a name when there's none", async () => {
    shell.mockResolvedValue({ state: "ok", result: {} });
    expect(await callTool("call", { tool: "generate_image", arguments: { prompt: "x" } })).toEqual({ content: [] });
    expect(shell).toHaveBeenCalledWith("/blastcp/mcp", { method: "tools/call", params: { name: "generate_image", arguments: { prompt: "x" } } });
    await callTool("call", { tool: "whoami" });
    expect(shell).toHaveBeenLastCalledWith("/blastcp/mcp", { method: "tools/call", params: { name: "whoami", arguments: {} } });
    expect(await callTool("call", {})).toMatchObject({ isError: true, content: [{ text: "Name the BlastCP tool to call." }] });
  });

  it("says Connect when BlastCP isn't connected and Reconnect when the sign-in ran out or was refused", async () => {
    shell.mockResolvedValueOnce({ state: "off" });
    expect(await callTool("generate_image")).toEqual({ content: [{ type: "text", text: NOT_CONNECTED }], isError: true });
    shell.mockResolvedValueOnce({ state: "expired" });
    expect(textOf(await callTool("generate_image"))).toBe(RECONNECT);
    shell.mockResolvedValueOnce({ state: "refused", message: "revoked" });
    expect(textOf(await callTool("generate_image"))).toMatch(/refused Weft's sign-in \(revoked\).*Reconnect/);
    expect(NOT_CONNECTED).toMatch(/🚀.*Connect/);
  });

  it("asks for a restart from a main without the route, and passes other failures on", async () => {
    shell.mockRejectedValueOnce(new Error("Not found"));
    expect(textOf(await callTool("generate_image"))).toBe(RESTART);
    shell.mockRejectedValueOnce(new Error("boom"));
    expect(await callTool("generate_image")).toEqual({ content: [{ type: "text", text: "boom" }], isError: true });
    shell.mockRejectedValueOnce("plain");
    expect(textOf(await callTool("generate_image"))).toBe("plain");
  });

  it("refuses on a worker without reaching main", async () => {
    vi.stubEnv("WEFT_WORKER", "1");
    vi.stubEnv("WEFT_SHELL_URL", "");
    expect(textOf(await callTool("generate_image"))).toBe(ON_WORKER);
    expect(shell).not.toHaveBeenCalled();
  });
});

describe("whyNot", () => {
  it("words each state", () => {
    expect(whyNot({ state: "refused" })).toMatch(/^BlastCP refused Weft's sign-in\. /);
    expect(whyNot({ state: "unavailable" })).toBe(RESTART);
    expect(whyNot({ state: "unavailable", message: "later" })).toBe("later");
    expect(whyNot({ state: "error", message: "bad prompt" })).toBe("BlastCP: bad prompt");
    expect(whyNot({ state: "error" })).toBe("BlastCP: the call failed.");
  });
});

describe("saveImages", () => {
  it("writes inline images to the show folder and says where", () => {
    const png = Buffer.from("png-bytes").toString("base64");
    const out = saveImages({ content: [{ type: "image", data: png, mimeType: "image/jpeg" }, { type: "image", data: png, mimeType: "image" }] }, show, 7);
    expect(fs.readFileSync(path.join(show, "7-0.jpg"), "utf8")).toBe("png-bytes");
    expect(fs.existsSync(path.join(show, "7-1.png"))).toBe(true);
    expect(out.content.at(-1)).toEqual({ type: "text", text: `Saved: ${path.join(show, "7-0.jpg")}, ${path.join(show, "7-1.png")}` });
  });

  it("leaves a result with no image alone, and saves under the show dir by default", async () => {
    const plain = { content: [{ type: "text" as const, text: "hi" }] };
    expect(saveImages(plain)).toBe(plain);
    shell.mockResolvedValue({ state: "ok", result: { content: [{ type: "image", data: "eA==", mimeType: "image/png" }] } });
    expect(textOf(await callTool("generate_image"))).toContain(path.join(show, "blastcp"));
  });

  it("defaults the show dir to ~/.weft/show", async () => {
    vi.stubEnv("WEFT_SHOW_DIR", undefined);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "blastcp-home-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    shell.mockResolvedValue({ state: "ok", result: { content: [{ type: "image", data: "eA==", mimeType: "image/png" }] } });
    expect(textOf(await callTool("generate_image"))).toContain(path.join(home, ".weft", "show", "blastcp"));
    vi.restoreAllMocks();
  });
});

describe("blastcpMcpServer", () => {
  it("serves BlastCP's list and calls over MCP", async () => {
    const config = blastcpMcpServer();
    expect(config).toMatchObject({ type: "sdk", name: "blastcp", timeout: 600_000 });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await config.instance.connect(a);
    const client = new Client({ name: "t", version: "1" });
    await client.connect(b);
    shell.mockResolvedValueOnce({ state: "ok", result: { tools: [GEN] } });
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["generate_image", "call"]);
    shell.mockResolvedValueOnce({ state: "ok", result: { content: [{ type: "text", text: "done" }] } });
    expect(await client.callTool({ name: "generate_image", arguments: { prompt: "a car" } })).toMatchObject({ content: [{ type: "text", text: "done" }] });
    shell.mockResolvedValueOnce({ state: "ok", result: { content: [] } });
    await client.callTool({ name: "whoami" });
    expect(shell).toHaveBeenLastCalledWith("/blastcp/mcp", { method: "tools/call", params: { name: "whoami", arguments: {} } });
    await client.close();
  });
});
