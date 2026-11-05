import { describe, expect, it } from "vitest";
import { codexGuardArgs } from "./codex";
import { GUARD_TOKEN_ENV, GUARD_URL_ENV } from "./turn";

// The `codex exec` args that put a turn's tool calls through Weft's guards: hooks on, the hook trusted, one
// hook config per event, and the turn's tokens kept out of the model's shell.

describe("codexGuardArgs", () => {
  const args = codexGuardArgs();

  it("turns hooks on and trusts the one Weft wrote", () => {
    expect(args).toContain("--enable");
    expect(args[args.indexOf("--enable") + 1]).toBe("hooks");
    expect(args).toContain("--dangerously-bypass-hook-trust");
  });

  it("gives Codex a hook for every event Weft guards", () => {
    const configs = args.filter((a, i) => args[i - 1] === "--config");
    expect(configs.some((c) => c.startsWith("hooks.PreToolUse="))).toBe(true);
    expect(configs.some((c) => c.startsWith("hooks.PostToolUse="))).toBe(true);
  });

  it("matches every tool and lets an ask wait for the card", () => {
    const configs = args.filter((a, i) => args[i - 1] === "--config" && a.startsWith("hooks."));
    expect(configs).toHaveLength(2);
    for (const config of configs) {
      expect(config).toContain('matcher="*"');
      expect(config).toContain("timeout=3600");
      expect(config).toContain('type="command"');
    }
  });

  it("posts the call to Weft's guard route", () => {
    const config = args.find((a) => a.startsWith("hooks.PreToolUse=")) as string;
    expect(config).toContain("$WEFT_GUARD_URL/codex/PreToolUse");
    expect(config).toContain("$WEFT_GUARD_TOKEN");
  });

  it("keeps the turn's tokens out of the model's shell", () => {
    const config = args.find((a) => a.startsWith("shell_environment_policy.exclude=")) as string;
    const excluded = JSON.parse(config.slice("shell_environment_policy.exclude=".length)) as string[];
    expect(excluded).toEqual([GUARD_TOKEN_ENV, GUARD_URL_ENV, "WEFT_MCP_TOKEN"]);
  });
});
