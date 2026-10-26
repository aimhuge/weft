// @vitest-environment node
// lib/goose-mcp.ts: Weft's tools reach a Goose turn through the card's own Goose config file, for that turn only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bridgeServer } from "./mcp-bridge";
import type { Session } from "./runner-state";

const servers = vi.hoisted((): { value: Record<string, unknown> } => ({ value: { browser: { instance: { name: "browser" } }, board: { instance: { name: "board" } } } }));
vi.mock("./weft-mcp", () => ({ weftMcpServers: () => servers.value }));

const { gooseConfigFile, gooseMcpConfig, openGooseMcp } = await import("./goose-mcp");

const session = (cardId: string | null = "card-1") => ({ cardId, spec: { cwd: "/tmp", backend: "goose" } }) as unknown as Session;

beforeEach(() => {
  vi.stubEnv("WEFT_DATA", fs.mkdtempSync(path.join(os.tmpdir(), "goose-mcp-")));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("gooseMcpConfig", () => {
  it("makes each server an mcp__ extension over HTTP, holding the turn's token", () => {
    const yaml = gooseMcpConfig("http://127.0.0.1:1024", ["browser"], "tok");
    expect(yaml).toBe(
      [
        "extensions:",
        '  "mcp__browser":',
        "    enabled: true",
        "    type: streamable_http",
        '    name: "mcp__browser"',
        '    uri: "http://127.0.0.1:1024/api/mcp/browser"',
        "    headers:",
        '      Authorization: "Bearer tok"',
        "    timeout: 600",
        "",
      ].join("\n"),
    );
  });
});

describe("openGooseMcp", () => {
  it("writes the card's Goose config for the turn, readable by the user only, and removes it after", () => {
    const close = openGooseMcp(session(), "1024");
    const file = gooseConfigFile("card-1");
    const yaml = fs.readFileSync(file, "utf8");
    expect(yaml).toContain('"mcp__browser"');
    expect(yaml).toContain('"mcp__board"');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const token = /Bearer ([^"]+)/.exec(yaml)?.[1] ?? "";
    // The token opens the turn's servers until the turn closes it.
    expect(bridgeServer(token, "browser")).toEqual({ name: "browser" });
    close();
    expect(fs.existsSync(file)).toBe(false);
    expect(bridgeServer(token, "browser")).toBeUndefined();
  });

  it("opens nothing outside the server, for a session with no card, or with no servers", () => {
    openGooseMcp(session(), undefined)();
    openGooseMcp(session(null), "1024")();
    servers.value = {};
    openGooseMcp(session(), "1024")();
    expect(fs.existsSync(gooseConfigFile("card-1"))).toBe(false);
    servers.value = { browser: { instance: {} } };
  });

  it("still runs the turn when the config can't be written", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("disk full");
    });
    const close = openGooseMcp(session(), "1024");
    expect(console.error).toHaveBeenCalled();
    close();
  });
});
