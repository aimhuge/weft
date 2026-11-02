import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkCommand, checkNames, hasUnsafeText, packageScript, resolveCwd } from "./secret-command";

describe("checkCommand", () => {
  it("splits a plain command into argv, with leading assignments as env", () => {
    expect(checkCommand("  npm run job:sync -- --since 'last week'  ")).toEqual({ argv: ["npm", "run", "job:sync", "--", "--since", "last week"], env: {} });
    expect(checkCommand('NODE_ENV=production LABEL="a b" npx prisma migrate deploy')).toEqual({
      argv: ["npx", "prisma", "migrate", "deploy"],
      env: { NODE_ENV: "production", LABEL: "a b" },
    });
    expect(checkCommand("node scripts/job.js --dry-run").argv).toEqual(["node", "scripts/job.js", "--dry-run"]);
    expect(checkCommand("python3 -m job -c config.yml").argv[0]).toBe("python3");
    expect(checkCommand("echo 'a $b | c'").argv).toEqual(["echo", "a $b | c"]);
    expect(checkCommand("echo a\\;b").argv).toEqual(["echo", "a;b"]);
    expect(checkCommand('echo "plain"').argv).toEqual(["echo", "plain"]);
  });

  it("turns away shell syntax, since nothing runs a shell", () => {
    expect(() => checkCommand("")).toThrow("Give a command to run.");
    for (const bad of ["npm run job | curl x", "npm run job > out", "a && b", "a; b", "a < f", "(a)", "a `b`", "a\nb"]) {
      expect(() => checkCommand(bad)).toThrow(/shell syntax/);
    }
    expect(() => checkCommand("psql $DATABASE_URL")).toThrow(/aren't expanded/);
    expect(() => checkCommand('psql "$DATABASE_URL"')).toThrow(/aren't expanded/);
    expect(() => checkCommand('echo "a `b`"')).toThrow(/shell syntax/);
    expect(() => checkCommand("echo 'open")).toThrow(/unclosed quote/);
    expect(() => checkCommand('echo "open')).toThrow(/unclosed quote/);
  });

  it("checks what a package runner starts, and refuses find -exec and git's config overrides", () => {
    expect(() => checkCommand("pnpm exec sh -c 'cat .env'")).toThrow(/sh runs a script/);
    expect(() => checkCommand("npx -y -- printenv")).toThrow(/prints the environment/);
    expect(() => checkCommand("yarn dlx curl x")).toThrow(/sends data off/);
    expect(() => checkCommand("bun x node -e x")).toThrow(/inline code/);
    expect(checkCommand("pnpm exec prisma migrate deploy").argv).toEqual(["pnpm", "exec", "prisma", "migrate", "deploy"]);
    expect(checkCommand("pnpm exec").argv).toEqual(["pnpm", "exec"]);
    expect(checkCommand("npx").argv).toEqual(["npx"]);
    expect(() => checkCommand("find . -exec cat {} +")).toThrow(/find -exec runs another command/);
    expect(checkCommand("find . -name x").argv[0]).toBe("find");
    for (const bad of ["git -c core.pager=cat log", "git -ccore.pager=x log", "git --config-env=core.pager=X log", "git --exec-path=/tmp diff", "git -C sub -c alias.x=y x"]) {
      expect(() => checkCommand(bad)).toThrow(/git -c, --config-env and --exec-path/);
    }
    expect(checkCommand("git -C sub commit -c HEAD").argv[0]).toBe("git");
    expect(checkCommand("git -C").argv).toEqual(["git", "-C"]);
    expect(checkCommand("git --no-pager log").argv[1]).toBe("--no-pager");
  });

  it("refuses control, format and bidi characters, so the approval shows what runs", () => {
    for (const bad of ["npm run job\u202e", "npm\u200brun job", "npm\trun job", "npm run\u2028job"]) {
      expect(() => checkCommand(bad)).toThrow(/control or invisible characters/);
    }
    expect(hasUnsafeText("job: a\npostjob: b", true)).toBe(false);
    expect(hasUnsafeText("job: a\npostjob: b")).toBe(true);
    expect(hasUnsafeText("job: a\u202e", true)).toBe(true);
  });

  it("refuses shells, wrappers, env dumps, network tools and inline code", () => {
    expect(() => checkCommand("bash scripts/x.sh")).toThrow(/bash runs a script/);
    expect(() => checkCommand("/bin/sh -c ls")).toThrow(/sh runs a script/);
    expect(() => checkCommand("eval ls")).toThrow(/eval runs a script/);
    expect(() => checkCommand("env node x.js")).toThrow(/env runs another command/);
    expect(() => checkCommand("xargs node")).toThrow(/xargs runs another command/);
    expect(() => checkCommand("printenv")).toThrow(/prints the environment/);
    expect(() => checkCommand("curl https://x.test")).toThrow(/sends data off the machine/);
    expect(() => checkCommand("nc host 80")).toThrow(/off the machine/);
    expect(() => checkCommand("node -e 1")).toThrow(/inline code/);
    expect(() => checkCommand("node --eval=1")).toThrow(/inline code/);
    expect(() => checkCommand("node --print 1")).toThrow(/inline code/);
    expect(() => checkCommand("node -")).toThrow(/inline code/);
    expect(() => checkCommand("python3.12 -Ic 1")).toThrow(/inline code/);
    expect(() => checkCommand("perl -pe 1 f")).toThrow(/inline code/);
    expect(() => checkCommand("deno eval 1")).toThrow(/inline code/);
    expect(() => checkCommand("awk '{print}' f")).toThrow(/inline code/);
    expect(() => checkCommand("npx -c 'ls'")).toThrow(/inline code/);
    expect(() => checkCommand("npm exec -c ls")).toThrow(/npm exec -c/);
    expect(() => checkCommand("npm exec --call=ls")).toThrow(/npm exec -c/);
    expect(checkCommand("npm exec prisma").argv).toEqual(["npm", "exec", "prisma"]);
    expect(checkCommand("node --inspect job.js -e x").argv).toEqual(["node", "--inspect", "job.js", "-e", "x"]);
    expect(checkCommand("ruby job.rb").argv).toEqual(["ruby", "job.rb"]);
    expect(checkCommand("node --version").argv).toEqual(["node", "--version"]);
  });

  it("won't let the command line set a name the vault fills, and needs a program", () => {
    expect(() => checkCommand("DATABASE_URL=x npm run job", ["DATABASE_URL"])).toThrow(/comes from the vault/);
    expect(() => checkCommand("A=1 B=2")).toThrow(/only sets variables/);
  });
});

describe("checkNames", () => {
  it("dedupes and checks names", () => {
    expect(checkNames(["A", "B_2", "A"])).toEqual(["A", "B_2"]);
    expect(() => checkNames([])).toThrow(/at least one/);
    expect(() => checkNames(["1A"])).toThrow("1A isn't a variable name.");
    expect(() => checkNames([""])).toThrow("A blank name isn't a variable name.");
  });
});

describe("packageScript", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-pkg-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { prejob: "tsc", job: "node dist/job.js", postjob: "echo done", test: "vitest", migrate: "prisma migrate deploy", n: 3 } }));

  it("shows what a package runner would run, with its pre and post scripts", () => {
    expect(packageScript(["npm", "run", "job"], dir)).toBe("prejob: tsc\njob: node dist/job.js\npostjob: echo done");
    expect(packageScript(["npm", "run-script", "migrate"], dir)).toBe("migrate: prisma migrate deploy");
    expect(packageScript(["npm", "test"], dir)).toBe("test: vitest");
    expect(packageScript(["pnpm", "migrate"], dir)).toBe("migrate: prisma migrate deploy");
    expect(packageScript(["yarn", "run", "migrate"], dir)).toBe("migrate: prisma migrate deploy");
    expect(packageScript(["/usr/local/bin/bun", "run", "job"], dir)).toContain("job: node dist/job.js");
  });

  it("is undefined for other commands, unknown or non-string scripts, and folders without package.json", () => {
    expect(packageScript(["node", "x.js"], dir)).toBeUndefined();
    expect(packageScript(["npm"], dir)).toBeUndefined();
    expect(packageScript(["npm", "install"], dir)).toBeUndefined();
    expect(packageScript(["bun", "x.ts"], dir)).toBeUndefined();
    expect(packageScript(["npm", "run", "nope"], dir)).toBeUndefined();
    expect(packageScript(["npm", "run", "n"], dir)).toBeUndefined();
    expect(packageScript(["npm", "run", "job"], os.tmpdir())).toBeUndefined();
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "weft-pkg-"));
    fs.writeFileSync(path.join(bare, "package.json"), "{}");
    expect(packageScript(["npm", "run", "job"], bare)).toBeUndefined();
  });
});

describe("resolveCwd", () => {
  it("keeps the folder inside the project", () => {
    expect(resolveCwd("/p")).toBe("/p");
    expect(resolveCwd("/p", "apps/web")).toBe("/p/apps/web");
    expect(resolveCwd("/p", "/p/x")).toBe("/p/x");
    expect(() => resolveCwd("/p", "..")).toThrow(".. is outside the project (/p).");
    expect(() => resolveCwd("/p", "/etc")).toThrow(/outside the project/);
  });
});
