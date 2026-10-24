import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { launcherScripts, RESTART_PROMPT, restartGuard, restartGuardMatcher, restartTarget, restartVerdict, weftProcess, type WeftProcess } from "./restart-guard";

const DIR = "/Users/me/dev/weft";
const WEFT: WeftProcess = {
  pids: [35937, 35900, 35000],
  port: "1000",
  dir: DIR,
  names: ["node", "next-server", "Electron", "Weft"],
  lines: [`node ${DIR}/node_modules/.bin/next dev -H 127.0.0.1 -p 1000`, "next-server", `${DIR}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .`],
};
const PROJECT = "/Users/me/dev/shop";

const hits = (command: string, cwd = PROJECT) => restartTarget(command, cwd, WEFT);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("restartTarget", () => {
  it.each([
    "kill -9 35937",
    "kill 35900",
    "kill -s KILL 35000",
    "kill -- -35937",
    "sudo kill -TERM 35937",
    "kill -9 $(lsof -ti :1000)",
    "lsof -ti :1000 | xargs kill -9",
    "lsof -nP -iTCP:1000 -sTCP:LISTEN -t | xargs -n 1 kill",
    "fuser -k 1000/tcp",
    "npx kill-port 1000",
    "kill-port 1000",
    "node electron/free-port.cjs 1000 .next",
    'pkill -f "next dev"',
    "pkill -f next-server",
    "pkill node",
    "pkill -i electron",
    "killall node",
    "killall -9 Electron",
    "killall -m 'Wef.*'",
    'bash -c "kill -9 35937"',
    "eval kill 35937",
    "env FOO=1 kill 35937",
    `osascript -e 'quit app "Weft"'`,
  ])("catches %s", (command) => {
    expect(hits(command)).toBeTruthy();
  });

  it("names what it would hit", () => {
    expect(hits("kill -9 35937")).toContain("pid 35937");
    expect(hits("lsof -ti :1000 | xargs kill")).toContain("port 1000");
    expect(hits("killall node")).toContain("killall node");
    expect(hits('pkill -f "next dev"')).toContain("pkill");
    expect(hits(`osascript -e 'quit app "Weft"'`)).toBe("the Weft app");
  });

  it.each([
    "kill -9 4242",
    "kill %1",
    "lsof -ti :3000 | xargs kill",
    "kill $(lsof -ti :3000)",
    "lsof -ti :1000",
    "fuser -k 3000/tcp",
    "npx kill-port 3000",
    'pkill -f "next dev -p 3000"',
    "pkill -f 'vite'",
    "killall -9 python",
    "npm run dev",
    "npx next dev -p 3001",
    "electron .",
    "ls -la",
    "kill",
    "pkill",
    "pkill -f",
  ])("leaves %s alone in a project", (command) => {
    expect(hits(command)).toBeNull();
  });

  it("catches a second Weft started in Weft's folder", () => {
    for (const command of ["npm run dev", "pnpm run desktop", "pnpm dev", "yarn desktop", "bun dev", "npm start", "yarn run start", "npx next dev", "next dev", "npx electron .", "electron ."]) {
      expect(hits(command, DIR)).toContain("second Weft");
    }
    expect(hits("npm run test", DIR)).toBeNull();
    expect(hits("npm install", DIR)).toBeNull();
    expect(hits("npm dev", DIR)).toBeNull();
    expect(hits("pnpm test", DIR)).toBeNull();
    expect(hits("npx tsc --noEmit", DIR)).toBeNull();
  });

  it("catches any script in Weft's package.json that frees its port or starts it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-scripts-"));
    const scripts = {
      dev: "node electron/free-port.cjs 1024 .next && next dev -p 1024",
      "dev:web": "node electron/free-port.cjs 1024 .next && WEFT_WEB=1 next dev -p 1024",
      app: "next build && electron .",
      lint: "eslint .",
    };
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts }));
    const weft = { ...WEFT, dir };
    // 2026-10-23: a card's `mcp__devservers__start pnpm dev:web` freed port 1024 and killed the server.
    for (const command of ["pnpm dev:web", "npm run dev:web", "yarn app", "pnpm run app"]) {
      expect(restartTarget(command, dir, weft)).toContain("second Weft");
    }
    expect(restartTarget("pnpm lint", dir, weft)).toBeNull();
    expect(restartTarget("pnpm dev:web", PROJECT, weft)).toBeNull();
    expect(launcherScripts(dir)).toEqual(new Set(["dev", "desktop", "start", "dev:web", "app"]));
  });

  it("falls back to dev, desktop and start without a readable package.json", () => {
    expect(launcherScripts("/no/such/folder")).toEqual(new Set(["dev", "desktop", "start"]));
  });

  it("knows every script in Weft's own package.json that would take it down", () => {
    const own = launcherScripts(process.cwd());
    for (const name of ["dev", "dev:web", "desktop", "start", "app"]) expect(own.has(name)).toBe(true);
    expect(own.has("test")).toBe(false);
  });

  it("follows cd to Weft's folder, but not cd elsewhere", () => {
    expect(hits(`cd ${DIR} && npm run dev`)).toContain("second Weft");
    expect(hits("cd ../weft && npm run desktop", "/Users/me/dev/shop")).toContain("second Weft");
    expect(hits(`cd ${PROJECT} && npm run dev`, DIR)).toBeNull();
    expect(hits("cd ~ && npm run dev", DIR)).toBeNull();
    expect(hits("cd && npm run dev", DIR)).toBeNull();
    expect(restartTarget("cd ~/dev/weft && npm run dev", "/", { ...WEFT, dir: `${os.homedir()}/dev/weft` })).toContain("second Weft");
  });

  it("reads into heredocs fed to a shell and stops at a deep nest", () => {
    const heredoc = "bash <<EOF\nkill 35937\nEOF";
    expect(hits(heredoc)).toBeTruthy();
    expect(hits("bash -c")).toBeNull();
    expect(hits(`${"bash -c '".repeat(1)}echo hi'`)).toBeNull();
    let deep = "kill 35937";
    for (let i = 0; i < 7; i++) deep = `echo $(${deep})`;
    expect(hits(deep)).toBeNull();
  });

  it("treats a pattern that isn't a valid regex as plain text", () => {
    expect(hits("pkill -f 'next dev ('")).toBeNull();
    expect(restartTarget("pkill -f '(Weft'", PROJECT, { ...WEFT, lines: ["/Applications/(Weft.app"] })).toBeTruthy();
    expect(hits("killall -m '('")).toBeNull();
    expect(restartTarget("pkill -if '(weft'", PROJECT, { ...WEFT, lines: ["/Applications/(Weft.app"] })).toBeTruthy();
  });

  it("skips pkill's and killall's valued options", () => {
    expect(hits("pkill -u me node")).toBeTruthy();
    expect(hits("pkill -u node")).toBeNull();
    expect(hits("killall -u node python")).toBeNull();
  });

  it("checks the port only when it's known", () => {
    expect(restartTarget("lsof -ti :1000 | xargs kill", PROJECT, { ...WEFT, port: "" })).toBeNull();
  });
});

describe("restartVerdict", () => {
  it("allows anything when no other turn is running", () => {
    expect(restartVerdict("kill -9 35937", PROJECT, WEFT, 0)).toBeNull();
  });

  it("allows a command that leaves Weft alone", () => {
    expect(restartVerdict("kill -9 4242", PROJECT, WEFT, 3)).toBeNull();
  });

  it("says how many turns a restart would cut off, and what's still fine", () => {
    expect(restartVerdict("kill -9 35937", PROJECT, WEFT, 1)).toContain("1 other turn is running");
    const why = restartVerdict("kill -9 35937", PROJECT, WEFT, 4) ?? "";
    expect(why).toContain("4 other turns are running");
    expect(why).toContain("tell the user");
    expect(why).toContain("(port 1000)");
    expect(restartVerdict("kill -9 35937", PROJECT, { ...WEFT, port: "" }, 2)).not.toContain("(port");
  });
});

describe("restartGuard", () => {
  const call = (input: Record<string, unknown>, others = 2) =>
    restartGuard(
      () => others,
      () => WEFT,
    )(input as never, undefined, { signal: new AbortController().signal });

  it("denies a command that would cut other turns off", async () => {
    const out = await call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "kill -9 35937" }, cwd: PROJECT });
    expect(out).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
  });

  it("lets everything else through", async () => {
    expect(await call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "kill -9 35937" }, cwd: PROJECT }, 0)).toEqual({});
    expect(await call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {}, cwd: PROJECT })).toEqual({});
    expect(await call({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { command: "kill 35937" }, cwd: PROJECT })).toEqual({});
    expect(await call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "kill 35937" }, cwd: PROJECT })).toEqual({});
  });

  it("finds Weft's own processes by default", async () => {
    const out = await restartGuard(() => 1)(
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: `kill ${process.pid}` }, cwd: PROJECT } as never,
      undefined,
      { signal: new AbortController().signal },
    );
    expect(JSON.stringify(out)).toContain(`pid ${process.pid}`);
  });

  it("comes as a Bash PreToolUse hook", () => {
    expect(restartGuardMatcher(() => 0).matcher).toBe("Bash");
  });
});

describe("weftProcess", () => {
  it("is this server, its parent, the app main.cjs names, and the port and folder it runs in", () => {
    vi.stubEnv("PORT", "1234");
    vi.stubEnv("WEFT_APP_PID", "777");
    const weft = weftProcess();
    expect(weft.pids).toEqual([process.pid, process.ppid, 777]);
    expect(weft.port).toBe("1234");
    expect(weft.dir).toBe(process.cwd());
    expect(weft.lines.join("\n")).toContain("next dev -H 127.0.0.1 -p 1234");
  });

  it("leaves out an app pid it wasn't given, and a port it doesn't know", () => {
    vi.stubEnv("WEFT_APP_PID", "");
    delete process.env.PORT;
    const weft = weftProcess();
    expect(weft.pids).toEqual([process.pid, process.ppid].filter((p) => p > 1));
    expect(weft.port).toBe("");
  });
});

describe("RESTART_PROMPT", () => {
  it("sends threads to restart when idle instead", () => {
    expect(RESTART_PROMPT).toMatch(/Never restart Weft/);
    expect(RESTART_PROMPT).toMatch(/mcp__board__restart_weft_when_idle/);
  });
});
