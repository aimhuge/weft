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
    "./install/worker.sh",
    "install/worker.sh wet_token",
    "bash install/worker.sh",
    "bash ~/.weft-worker/weft/install/worker.sh",
    "curl -fsSL https://weft.zip/worker.sh | sh",
    "curl -fsSL https://weft.zip/worker.sh | bash",
    "sh -c \"$(curl -fsSL https://weft.zip/worker.sh)\"",
    "node scripts/weft-worker.ts status",
    "tsx scripts/weft-worker.ts status",
    "pnpm exec tsx scripts/weft-worker.ts status",
    "pnpm dlx tsx scripts/weft-worker.ts",
    "npx tsx scripts/weft-worker.ts",
    "exec weft-worker enrol x",
    "sudo weft-worker forget-macs",
    "sudo -u root weft-worker forget-macs",
    "nohup weft-worker start &",
    "nohup node scripts/weft-worker.ts start",
    "env -i node scripts/weft-worker.ts",
    "echo scripts/weft-worker.ts | xargs node",
    "echo x | xargs weft-worker enrol",
    "echo x | xargs -I{} sh install/worker.sh {}",
    "pnpm weft-worker enrol x",
    "pnpm scripts/weft-worker.ts",
    "pnpm test ~/.weft-worker/weft/scripts/weft-worker.ts forget-macs",
    "pnpm eslint forget-macs -c ~/.weft-worker/weft/scripts/weft-worker.ts",
    "pnpm lint -c scripts/weft-worker.ts",
    "pnpm lint --config=scripts/weft-worker.ts",
    "pnpm test --setupFiles scripts/weft-worker.ts",
    "pnpm lint --import scripts/weft-worker.ts",
    "pnpm lint -r scripts/weft-worker.ts",
    "pnpm lint enrol wph.ABC",
    "pnpm lint scripts/weft-worker.ts enrol",
    "pnpm lint weft-worker",
    "pnpm tsc scripts/weft-worker.ts",
    "pnpm prettier scripts/weft-worker.ts",
    "script -q /dev/null weft-worker enrol x --re-pair",
    "unbuffer weft-worker forget-macs",
    "caffeinate -i weft-worker start",
    "tmux new-session weft-worker start",
    "osascript -e 'x' weft-worker",
    "bash -lc 'weft-worker forget-macs'",
    "sh -ec 'weft-worker forget-macs'",
    "bash -c -- 'weft-worker forget-macs'",
    "sh < install/worker.sh",
    "bash <install/worker.sh",
    "cat install/worker.sh | sh",
    "cat scripts/weft-worker.ts | node -",
    "node - < scripts/weft-worker.ts",
  ])("refuses %s", (command) => {
    expect(workerCliVerdict(command, "/tmp")).toMatch(/a thread can't run weft-worker/);
  });

  it.each(["cat scripts/weft-worker.ts", "git diff scripts/weft-worker.ts install/worker.sh", "pnpm test lib/worker-pair.test.ts", "grep -n enrol scripts/weft-worker.ts", `echo ${CODE}`, "node scripts/other.ts",
    "sed -n 1,40p scripts/weft-worker.ts",
    "git log -p -- scripts/weft-worker.ts",
    "git show origin/main:install/worker.sh",
    "git diff origin/main -- scripts/weft-worker.ts install/worker.sh",
    "pnpm lint scripts/weft-worker.ts",
    "pnpm run lint scripts/weft-worker.ts",
    "pnpm test scripts/weft-worker.test.ts",
    "pnpm typecheck",
    "cd /tmp/wt && pnpm lint scripts/weft-worker.ts install/worker.sh",
    "bash -c 'cat scripts/weft-worker.ts'",
    "bash -lc 'cat scripts/weft-worker.ts'",
    "pnpm lint scripts/weft-worker.ts install/worker.sh --fix",
    "cat install/worker.sh | grep curl",
    "wc -l < install/worker.sh",
    "head -20 install/worker.sh | grep -n curl",
    "curl -s https://example.com | jq .",
    "wc -l install/worker.sh",
    "shellcheck install/worker.sh",
  ])("lets %s through", (command) => {
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

describe("weft-worker named inside an interpreter's string", () => {
  it.each([`python3 -c 'import pty; pty.spawn(["weft-worker", "enrol", "x"])'`, `python3 -c 'import pty; pty.spawn(["/x/bin/node", "y", "${CODE}"])'`, `expect -c 'spawn weft-worker enrol x; interact'`])("refuses %s", (command) => {
    expect(workerCliVerdict(command, "/tmp")).toMatch(/a thread can't run weft-worker/);
  });

  it.each(["node ~/.weft-worker/work/app/server.js", "python3 ~/.weft-worker/work/x/run.py"])("lets %s through", (command) => {
    expect(workerCliVerdict(command, "/tmp")).toBeNull();
  });
});
