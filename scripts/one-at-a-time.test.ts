import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commandLine, lockPath, onPath, shellQuote, tryLock, unlock, waitForLock } from "./one-at-a-time.mjs";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "one-at-a-time-"));
  file = lockPath("typecheck", dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

// A pid no process has: a finished child's.
function deadPid() {
  return Number(execFileSync("sh", ["-c", "echo $$"], { encoding: "utf8" }));
}

describe("lockPath", () => {
  it("names the lock after the check, safe for a file name", () => {
    expect(lockPath("lint", "/t")).toBe("/t/weft-lint.lock");
    expect(lockPath("a/b c", "/t")).toBe("/t/weft-a_b_c.lock");
  });
});

describe("tryLock and unlock", () => {
  it("takes a free lock, refuses a held one, and frees it for its holder only", () => {
    expect(tryLock(file, process.pid)).toBe(true);
    expect(tryLock(file, process.pid + 1)).toBe(false);
    unlock(file, process.pid + 1);
    expect(fs.existsSync(file)).toBe(true);
    unlock(file, process.pid);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("takes over a lock whose holder has exited", () => {
    fs.writeFileSync(file, String(deadPid()));
    expect(tryLock(file, process.pid)).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe(String(process.pid));
  });

  it("unlock is quiet when the lock is already gone", () => {
    expect(() => unlock(file)).not.toThrow();
  });
});

describe("waitForLock", () => {
  it("waits while another process holds it, telling once, then takes it when freed", async () => {
    fs.writeFileSync(file, String(process.ppid));
    const waits: number[] = [];
    const waiting = waitForLock(file, { poll: 5, onWait: (pid: number) => waits.push(pid) });
    await new Promise((resolve) => setTimeout(resolve, 30));
    fs.rmSync(file);
    await waiting;
    expect(waits).toEqual([process.ppid]);
    expect(fs.readFileSync(file, "utf8")).toBe(String(process.pid));
  });
});

describe("the command line", () => {
  const script = path.join(__dirname, "one-at-a-time.mjs");

  it("runs the command with its args and passes its exit code through", () => {
    const run = (cmd: string) => {
      try {
        return execFileSync(process.execPath, [script, `test-${process.pid}`, cmd, "x"], { encoding: "utf8" });
      } catch (err) {
        return (err as { status: number }).status;
      }
    };
    expect(run("echo hi")).toBe("hi x\n");
    expect(run("exit 3 ;")).toBe(3);
  });

  it("passes a signal that stops it on to the command, and frees the lock", async () => {
    const name = `signal-${process.pid}`;
    const proc = spawn(process.execPath, [script, name, "echo $$; exec sleep 30"], {
      env: { ...process.env, TSC_ONCE_ACTIVE: "1" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    const child = await new Promise<number>((resolve) => proc.stdout.once("data", (d: Buffer) => resolve(Number(d.toString().trim()))));
    const exited = new Promise<number | null>((resolve) => proc.on("exit", (code) => resolve(code)));
    proc.kill("SIGTERM");
    expect(await exited).toBe(130);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(() => process.kill(child, 0)).toThrow();
    expect(fs.existsSync(lockPath(name))).toBe(false);
  });

  it("hands a path with ( ), [ ], spaces or quotes to the command as one word", () => {
    const paths = ["app/(admin)/admin/layout.tsx", "app/[orgSlug]/page.tsx", "my dir/it's $NOPE;`x`.ts"];
    const out = execFileSync(process.execPath, [script, `quote-${process.pid}`, "printf '%s\\n'", ...paths], {
      encoding: "utf8",
      env: { ...process.env, TSC_ONCE_ACTIVE: "1" },
    });
    expect(out).toBe(paths.map((p) => `${p}\n`).join(""));
  });

  it("explains its usage without a command", () => {
    expect(() => execFileSync(process.execPath, [script, "lint"], { stdio: "pipe" })).toThrow();
  });
});

describe("commandLine", () => {
  it("keeps the command as shell syntax and quotes only the args that need it", () => {
    expect(commandLine("next typegen && tsc --noEmit")).toBe("next typegen && tsc --noEmit");
    expect(commandLine("eslint --max-warnings 0", ["lib/x.ts", "app/(admin)/a.tsx"])).toBe(
      "eslint --max-warnings 0 lib/x.ts 'app/(admin)/a.tsx'",
    );
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote("")).toBe("''");
  });
});

describe("onPath", () => {
  it("finds an executable on the given PATH dirs, and null when none has it", () => {
    const bin = path.join(dir, "tsc-once");
    fs.writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "plain"), "", { mode: 0o644 });
    expect(onPath("tsc-once", ["/nope", dir])).toBe(bin);
    expect(onPath("plain", [dir])).toBeNull();
    expect(onPath("tsc-once", ["/nope"])).toBeNull();
  });
});
