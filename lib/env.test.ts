import { afterEach, describe, expect, it, vi } from "vitest";
import { cliEnv, guardedCli } from "./env";
import { CHECK_GUARD_MATCHER } from "./check-guard";
import { GIT_GUARD_MATCHER } from "./git-guard";
import { IMPORT_GUARD_MATCHER } from "./import-check";
import { ROUTE_IMPORT_GUARD_MATCHER } from "./route-import-guard";
import { SECRET_GUARD_MATCHER } from "./secret-guard";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cliEnv", () => {
  it("asks for a 1-hour prompt cache", () => {
    vi.stubEnv("CLAUDE_CODE_PROMPT_CACHE_TTL", "5m");
    expect(cliEnv().CLAUDE_CODE_PROMPT_CACHE_TTL).toBe("1h");
  });

  it("strips a parent Claude Code session's variables and marks the CLI as an SDK session", () => {
    vi.stubEnv("CLAUDECODE", "1");
    vi.stubEnv("CLAUDE_CODE_SSE_PORT", "1234");
    vi.stubEnv("CLAUDE_AGENT_SDK_VERSION", "0.1");
    vi.stubEnv("CLAUDE_PID", "42");
    vi.stubEnv("CLAUDE_EFFORT", "high");
    vi.stubEnv("CLAUDE_PREVIEW_URL", "http://x");
    vi.stubEnv("CLAUDE_CODE_ENTRYPOINT", "cli");

    const env = cliEnv();

    for (const key of ["CLAUDECODE", "CLAUDE_CODE_SSE_PORT", "CLAUDE_AGENT_SDK_VERSION", "CLAUDE_PID", "CLAUDE_EFFORT", "CLAUDE_PREVIEW_URL"]) {
      expect(env).not.toHaveProperty(key);
    }
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBe("sdk-ts");
    expect(env.WEFT_SERVER_PID).toBe(String(process.pid));
  });

  it("strips Weft's own keys, like the browser pane's control-server token", () => {
    vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:5000");
    vi.stubEnv("WEFT_SHELL_TOKEN", "secret");
    vi.stubEnv("WEFT_DATA", "/tmp/weft");

    const env = cliEnv();

    expect(env).not.toHaveProperty("WEFT_SHELL_URL");
    expect(env).not.toHaveProperty("WEFT_SHELL_TOKEN");
    expect(env.WEFT_DATA).toBe("/tmp/weft");
  });

  it("strips what Weft's own next dev set, so a thread's next build runs in production mode", () => {
    const strip = { NODE_ENV: "development", PORT: "1000", NEXT_RUNTIME: "nodejs", NEXT_DEPLOYMENT_ID: "d", __NEXT_DEV_SERVER: "1",
      __NEXT_PRIVATE_ORIGIN: "http://127.0.0.1:1000", NEXT_PRIVATE_WORKER: "1", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_CPU_PROF_DIR: "/p", NEXT_TURBOPACK_TRACING: "1", TURBOPACK: "1", TURBOPACK_TRACING: "1", WATCHPACK_WATCHER_LIMIT: "20" };
    const keep = { NEXT_TELEMETRY_DISABLED: "1", NODE_EXTRA_CA_CERTS: "/ca.pem", PORTAL: "x", MY_PORT: "3000", NODE_ENVIRONMENT: "x" };
    for (const [k, v] of Object.entries({ ...strip, ...keep })) vi.stubEnv(k, v);

    const env = cliEnv();

    for (const k of Object.keys(strip)) expect(env, k).not.toHaveProperty(k);
    for (const [k, v] of Object.entries(keep)) expect(env[k], k).toBe(v);
  });

  // Built from pieces so this file never holds a whole key for a scanner to flag.
  const STRIPE_SHAPED = ["sk", "live", "51Habcdefghijklmnopqrstuv"].join("_");
  const ANTHROPIC_SHAPED = ["sk-ant", "api03", "abcdefghijklmnopqrstuvwxyz"].join("-");

  it("strips your own secrets by name or by value, but keeps what the CLIs sign in with", () => {
    const strip = { STRIPE_SECRET_KEY: "sk", OPENAI_API_KEY: "x", GITHUB_TOKEN: "x", NPM_TOKENS: "x", DB_PASSWORD: "x", AWS_CREDENTIALS: "x",
      GH_PAT: "x", SENTRY_DSN: "x", DATABASE_URL: "x", SUPABASE_DATABASE_URL: "x", private: "x", MY_SETTING: STRIPE_SHAPED };
    const keep = { ANTHROPIC_API_KEY: ANTHROPIC_SHAPED, ANTHROPIC_AUTH_TOKEN: "t", PUKU_API_KEY: "p", SSH_AUTH_SOCK: "/tmp/agent",
      MONKEY: "1", KEYCHAIN_PATH: "/k", PATH: "/usr/bin", TOKENIZER: "1", DATABASE_URL_FILE: "/f", HOME: "/Users/me" };
    for (const [k, v] of Object.entries({ ...strip, ...keep })) vi.stubEnv(k, v);

    const env = cliEnv();

    for (const k of Object.keys(strip)) expect(env, k).not.toHaveProperty(k);
    for (const [k, v] of Object.entries(keep)) expect(env[k], k).toBe(v);
  });

  // Loader hooks run code in a thread's process before it runs its own, so they go by name whatever
  // they hold (2026-10-28).
  it("strips the loader hooks, and keeps the certificate one", () => {
    const strip = { NODE_OPTIONS: "--require /tmp/leak.js", LD_PRELOAD: "/tmp/leak.so", LD_AUDIT: "/tmp/audit.so", LD_LIBRARY_PATH: "/tmp", DYLD_INSERT_LIBRARIES: "/tmp/leak.dylib", DYLD_LIBRARY_PATH: "/tmp", DYLD_FRAMEWORK_PATH: "/tmp" };
    const keep = { NODE_EXTRA_CA_CERTS: "/ca.pem" };
    for (const [k, v] of Object.entries({ ...strip, ...keep })) vi.stubEnv(k, v);

    const env = cliEnv();

    for (const k of Object.keys(strip)) expect(env, k).not.toHaveProperty(k);
    for (const [k, v] of Object.entries(keep)) expect(env[k], k).toBe(v);
  });

  it("keeps unrelated and look-alike variables", () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", "/tmp/claude");
    vi.stubEnv("CLAUDE_PIDS", "keep");
    vi.stubEnv("CLAUDECODE_EXTRA", "keep");
    vi.stubEnv("PATH", "/usr/bin");

    const env = cliEnv();

    expect(env.CLAUDE_CONFIG_DIR).toBe("/tmp/claude");
    expect(env.CLAUDE_PIDS).toBe("keep");
    expect(env.CLAUDECODE_EXTRA).toBe("keep");
    expect(env.PATH).toBe("/usr/bin");
  });

  it("drops ANTHROPIC_BASE_URL when started inside Claude Code", () => {
    vi.stubEnv("CLAUDECODE", "1");
    vi.stubEnv("ANTHROPIC_BASE_URL", "http://127.0.0.1:9999");
    expect(cliEnv()).not.toHaveProperty("ANTHROPIC_BASE_URL");
  });

  it("drops ANTHROPIC_BASE_URL when started from the Claude desktop app", () => {
    vi.stubEnv("CLAUDECODE", "");
    vi.stubEnv("CLAUDE_CODE_DESKTOP_APP_VERSION", "1.2.3");
    vi.stubEnv("ANTHROPIC_BASE_URL", "http://127.0.0.1:9999");
    expect(cliEnv()).not.toHaveProperty("ANTHROPIC_BASE_URL");
  });

  it("keeps the user's own ANTHROPIC_BASE_URL outside Claude", () => {
    vi.stubEnv("CLAUDECODE", "");
    vi.stubEnv("CLAUDE_CODE_DESKTOP_APP_VERSION", "");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://proxy.example.com");
    expect(cliEnv().ANTHROPIC_BASE_URL).toBe("https://proxy.example.com");
  });

  // A Weft Worker's CLIs sign in with `claude setup-token`'s token, since no keychain prompt can be answered there.
  it("keeps Claude Code's OAuth token outside Claude, and drops a Claude session's own", () => {
    vi.stubEnv("CLAUDECODE", "");
    vi.stubEnv("CLAUDE_CODE_DESKTOP_APP_VERSION", "");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "oauth");
    expect(cliEnv().CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth");
    vi.stubEnv("CLAUDECODE", "1");
    expect(cliEnv()).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
  });

  it("returns a copy and leaves process.env alone", () => {
    vi.stubEnv("CLAUDECODE", "1");
    vi.stubEnv("CLAUDE_CODE_ENTRYPOINT", "cli");
    const env = cliEnv();
    expect(env).not.toBe(process.env);
    expect(process.env.CLAUDECODE).toBe("1");
    expect(process.env.CLAUDE_CODE_ENTRYPOINT).toBe("cli");
  });
});

describe("guardedCli", () => {
  it("starts a thread with the stripped env, the secret guard, the restart guard, the git guard, the check guard, the route import guard, the import guard, the folder gate, symbol claims for edits and Bash, and the changelog stamp", () => {
    vi.stubEnv("WEFT_SHELL_TOKEN", "secret");
    const opts = guardedCli(() => 0, () => undefined);
    expect(opts.env).not.toHaveProperty("WEFT_SHELL_TOKEN");
    const post = opts.hooks?.PostToolUse ?? [];
    expect(post[0]).toBe(IMPORT_GUARD_MATCHER);
    expect(post[1]?.matcher).toBe("Edit|MultiEdit|Write|NotebookEdit");
    expect(post[2]?.matcher).toBe("Bash");
    expect(opts.hooks?.PostToolUseFailure?.[0]).toBe(post[2]);
    const pre = opts.hooks?.PreToolUse ?? [];
    expect(pre[0]).toBe(SECRET_GUARD_MATCHER);
    expect(pre[1]?.matcher).toBe("Bash");
    expect(pre[2]).toBe(GIT_GUARD_MATCHER);
    expect(pre[3]).toBe(CHECK_GUARD_MATCHER);
    expect(pre[4]).toBe(ROUTE_IMPORT_GUARD_MATCHER);
    expect(pre[5]?.matcher).toBe("Read|Edit|MultiEdit|Write|NotebookEdit|Glob|Grep|LS|Bash"); // the folder gate
    expect(pre[6]?.matcher).toBe("Edit|MultiEdit|Write|NotebookEdit");
    expect(pre[7]?.matcher).toBe("Bash"); // Bash claims
    expect(pre[8]?.matcher).toBe("Bash"); // the changelog stamp's HEAD before a commit
    expect(post[3]?.matcher).toBe("Bash"); // and its stamp after
  });

  it("counts other cards' turns with the function it's given", async () => {
    vi.stubEnv("PORT", "1000");
    const others = vi.fn(() => 2);
    const hook = guardedCli(others, () => undefined).hooks?.PreToolUse?.[1]?.hooks[0];
    const input = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "lsof -ti :1000 | xargs kill" }, cwd: "/tmp" };
    const out = await hook?.(input as never, undefined, { signal: new AbortController().signal });
    expect(others).toHaveBeenCalled();
    expect(JSON.stringify(out)).toContain("2 other turns");
  });
});
