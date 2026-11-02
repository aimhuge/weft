import { describe, expect, it } from "vitest";
import { guardHooks } from "./guards/hooks";
import { runsWorkerCli, WORKER_CLI_GUARD_MATCHER, workerCliGuard, workerCliVerdict } from "./worker-cli-guard";

const CODE = "wph.11111111-2222-4333-8444-555555555555.aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.secret";

describe("workerCliVerdict", () => {
  it.each([
    `weft-worker enrol ${CODE}`,
    "weft-worker forget-macs",
    "~/.weft-worker/bin/weft-worker status",
    "cd ~/.weft-worker/weft && node node_modules/.bin/jiti scripts/weft-worker.ts enrol x",
    "pnpm exec jiti scripts/weft-worker.ts forget-macs",
    "./scripts/weft-worker.ts start",
    "sh install/worker.sh wet_token",
    `curl -fsSL https://weft.zip/worker.sh | sh -s -- ${CODE}`,
    "bash -c 'weft-worker enrol x'",
    "echo ok && weft-worker forget-macs",
    "env FOO=1 weft-worker enrol x",
    // A terminal of its own, or a wrapper: the re-pair needs a signature now, but these stay refused.
    "script -q /dev/null weft-worker enrol x --re-pair",
    "script -q -c 'weft-worker enrol x --re-pair' /dev/null",
    "unbuffer weft-worker enrol x",
    "expect -c 'spawn weft-worker enrol x; interact'",
    "timeout 60 weft-worker forget-macs",
    "stdbuf -o0 weft-worker forget-macs",
    "caffeinate -i ~/.weft-worker/bin/weft-worker start",
    `python3 -c 'import pty; pty.spawn(["weft-worker", "enrol", "x"])'`,
    `python3 -c 'import pty; pty.spawn(["/x/bin/node", "y", "${CODE}"])'`,
    "xargs weft-worker enrol < codes",
  ])("refuses %s", (command) => {
    expect(workerCliVerdict(command, "/tmp")).toMatch(/a thread can't run weft-worker/);
  });

  it.each(["cat scripts/weft-worker.ts", "git diff scripts/weft-worker.ts install/worker.sh", "pnpm test lib/worker-pair.test.ts", "grep -n enrol scripts/weft-worker.ts", `echo ${CODE}`, "node scripts/other.ts", "node ~/.weft-worker/work/app/server.js", "timeout 5 pnpm test", "python3 ~/.weft-worker/work/x/run.py"])("lets %s through", (command) => {
    expect(workerCliVerdict(command, "/tmp")).toBeNull();
  });

  it("reads a step by its program and args", () => {
    expect(runsWorkerCli({ name: "node", args: ["x.js", CODE], cwd: "/" })).toBe(true);
    expect(runsWorkerCli({ name: "less", args: ["worker.sh"], cwd: "/" })).toBe(false);
  });
});

describe("workerCliGuard", () => {
  const run = (input: Record<string, unknown>) => workerCliGuard({ hook_event_name: "PreToolUse", tool_name: "Bash", cwd: "/tmp", ...input } as never, undefined, { signal: new AbortController().signal });

  it("denies the worker's command line from Bash and is in every thread's guard set", async () => {
    expect(await run({ tool_input: { command: "weft-worker forget-macs" } })).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect(await run({ tool_input: { command: "ls" } })).toEqual({});
    expect(await run({ tool_input: {} })).toEqual({});
    expect(await run({ tool_name: "Read", tool_input: { command: "weft-worker" } })).toEqual({});
    expect(await run({ hook_event_name: "PostToolUse", tool_input: { command: "weft-worker" } })).toEqual({});
    expect(guardHooks(() => 0, () => undefined).PreToolUse).toContain(WORKER_CLI_GUARD_MATCHER);
  });
});
