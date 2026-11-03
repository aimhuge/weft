// How a Goose turn starts with its provider's key (lib/goose-launch.ts): on a Mac through main's one-time grant, on a Weft
// Worker with the key the paired Mac sealed to it (lib/worker-goose-key.ts), straight into that one process's env.
import { afterEach, describe, expect, it, vi } from "vitest";

const asked = vi.hoisted(() => ({ env: undefined as Record<string, string> | undefined, req: [] as unknown[] }));
vi.mock("./worker-goose-key", () => ({
  gooseKeyOnWorker: (req: unknown) => {
    asked.req.push(req);
    return Promise.resolve(asked.env);
  },
}));

import { gooseLaunch } from "./goose-launch";

afterEach(() => {
  vi.unstubAllEnvs();
  asked.req.length = 0;
  asked.env = undefined;
});

describe("gooseLaunch on a worker", () => {
  it("starts Goose itself with the Mac's key in its env, for this card's provider and endpoint", async () => {
    vi.stubEnv("WEFT_WORKER", "1");
    vi.stubEnv("WEFT_SHELL_URL", "");
    asked.env = { ANTHROPIC_API_KEY: "sk-ant-1", ANTHROPIC_HOST: "https://gw" };
    expect(await gooseLaunch("anthropic", ["/bin/goose", "run", "--text", "hi"], {}, "/w/p", "https://gw", "c1")).toEqual({ bin: "/bin/goose", args: ["run", "--text", "hi"], env: asked.env, stdin: "", names: ["ANTHROPIC_API_KEY", "ANTHROPIC_HOST"] });
    expect(asked.req).toEqual([{ cardId: "c1", providerId: "anthropic", baseUrl: "https://gw" }]);
  });

  it("starts the plain binary when no key comes, as it did before", async () => {
    vi.stubEnv("WEFT_WORKER", "1");
    vi.stubEnv("WEFT_SHELL_URL", "");
    expect(await gooseLaunch("ollama", [], {}, undefined, "", "c1")).toBeUndefined();
  });
});

describe("gooseLaunch on a Mac without the desktop app", () => {
  it("has no grant to start with, and never asks a Mac", async () => {
    vi.stubEnv("WEFT_WORKER", "");
    vi.stubEnv("WEFT_SHELL_URL", "");
    expect(await gooseLaunch("anthropic", ["/bin/goose"])).toBeUndefined();
    expect(asked.req).toEqual([]);
  });
});
