import { describe, expect, it } from "vitest";
import { MIGRATIONS, commitStatus, daemonStatus, migrationSql, parseArgs, rowSql, updateNote } from "./live-pass-status.mjs";

const HEAD = "a".repeat(40);
const MAIN = "b".repeat(40);

function fakeGit(answers: Record<string, string | null>) {
  return (_clone: string, ...args: string[]): string | null => answers[args.join(" ")] ?? null;
}

const behindGit = fakeGit({
  "rev-parse HEAD": HEAD,
  "rev-parse --abbrev-ref HEAD": "main",
  "log -1 --format=%s HEAD": "fix: a thing",
  "status --porcelain --untracked-files=no": "",
  "ls-remote origin refs/heads/main": `${MAIN}\trefs/heads/main`,
  [`cat-file -e ${MAIN}^{commit}`]: "",
  [`rev-list --count HEAD..${MAIN}`]: "29",
  [`rev-list --count ${MAIN}..HEAD`]: "0",
});

describe("parseArgs", () => {
  it("defaults to the worker clone and m1mini", () => {
    const opts = parseArgs([]);
    expect(opts.clone).toMatch(/\.weft-worker\/weft$/);
    expect(opts).toMatchObject({ name: "m1mini", json: false });
  });

  it("takes a clone, a name and --json, and refuses anything else", () => {
    expect(parseArgs(["--clone", "/x", "--name", "box", "--json"])).toEqual({ clone: "/x", name: "box", json: true });
    expect(() => parseArgs(["--token", "t"])).toThrow("Unknown argument: --token");
    expect(() => parseArgs(["--name"])).toThrow("need a value");
  });
});

describe("commitStatus and updateNote", () => {
  it("counts how far behind origin/main the clone is", () => {
    const c = commitStatus("/clone", behindGit);
    expect(c).toMatchObject({ ok: true, head: HEAD, main: MAIN, behind: 29, ahead: 0, dirty: 0 });
    expect(updateNote(c)).toBe("29 commit(s) behind; updates itself once no card on it has a live turn");
  });

  it("says when the newest main isn't fetched yet", () => {
    const git = fakeGit({ "rev-parse HEAD": HEAD, "rev-parse --abbrev-ref HEAD": "main", "ls-remote origin refs/heads/main": MAIN });
    expect(updateNote(commitStatus("/clone", git))).toMatch(/count unknown/);
  });

  it("names what holds the updater back", () => {
    const base = { ok: true, head: HEAD, main: MAIN, branch: "main", dirty: 0, ahead: 0, behind: 1 };
    expect(updateNote({ ...base, head: MAIN })).toBe("up to date with origin/main");
    expect(updateNote({ ...base, branch: "dev" })).toMatch(/off main/);
    expect(updateNote({ ...base, dirty: 2 })).toMatch(/2 local change/);
    expect(updateNote({ ...base, ahead: 3 })).toMatch(/ahead of origin\/main by 3/);
    expect(updateNote({ ...base, main: null })).toMatch(/unreachable/);
    expect(updateNote(commitStatus("/nope", fakeGit({})))).toMatch(/not a git checkout/);
  });
});

describe("daemonStatus", () => {
  const table = [
    { pid: 10, ppid: 1, etime: "01:00", command: "node node_modules/jiti/lib/jiti-cli.mjs scripts/weft-worker.ts start" },
    { pid: 11, ppid: 10, etime: "00:50", command: "/x/claude --output-format stream-json" },
    { pid: 12, ppid: 10, etime: "00:50", command: "git fetch" },
  ];

  it("finds the daemon and counts the CLIs under it", () => {
    const service = { manager: "launchd", loaded: true, pid: 10, lastExit: 0 };
    expect(daemonStatus("darwin", table, service)).toEqual({ service, running: true, pid: 10, uptime: "01:00", cliProcesses: 1 });
  });

  it("reports a stopped daemon", () => {
    expect(daemonStatus("darwin", table.slice(1), { manager: "launchd", loaded: false })).toMatchObject({ running: false, pid: null });
  });
});

describe("SQL", () => {
  it("reads the row by name, quoted, with no token", () => {
    expect(rowSql("m1'mini")).toContain("where name = 'm1''mini'");
    expect(rowSql("m1mini")).toContain("as fresh");
  });

  it("checks every migration and both check lists", () => {
    const sql = migrationSql();
    for (const [version] of MIGRATIONS) expect(sql).toContain(`'${version}'`);
    expect(sql).toContain("cloud_commands_kind_check");
    expect(sql).toContain("device_calls_tool_check");
  });
});
