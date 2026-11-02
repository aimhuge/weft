// Main's port of lib/secret-command.ts checkCommand (electron/command-rules.cjs) must accept and refuse what lib's does,
// and split a command into the same argv.
import { describe, expect, it } from "vitest";
import { checkCommand as libCheck } from "../lib/secret-command";
import { checkCommand, hasUnsafe, shellSyntax, words } from "./command-rules.cjs";

const COMMANDS = [
  "npm run job",
  "  pnpm   migrate  ",
  "NODE_ENV=production node scripts/job.js --flag",
  "node 'my dir/job.js' \"two words\" a\\ b",
  'node "say \\"hi\\"" x',
  "python3 manage.py migrate",
  "python -c 'print(1)'",
  "node -e 'x'",
  "node --eval=x",
  "perl -pe s/a/b/",
  "bun -",
  "deno eval x",
  "awk '{print}'",
  "npx -c 'echo'",
  "npm exec -c 'echo'",
  "npm exec --call=x",
  "sh -c 'cat .env'",
  "/bin/bash script.sh",
  "env FOO=1 node x",
  "sudo node x",
  "printenv",
  "curl https://example.com",
  "ls | grep x",
  "echo $HOME",
  'echo "$(id)"',
  "node x > out",
  "node 'unclosed",
  'node "unclosed',
  "A=1 B=2",
  "TOKEN=x npm run job",
  "",
  "npm run job‮",
  "npm​ run job",
  "npm\trun job",
  "pnpm exec sh -c 'cat .env'",
  "pnpm exec -- node x.js",
  "pnpm dlx printenv",
  "npx -y bash x.sh",
  "npx prisma migrate deploy",
  "npm x -- curl x",
  "yarn exec env",
  "yarn dlx tsx x.ts",
  "bunx node -e x",
  "bun x sh",
  "pnpm exec",
  "find . -name x",
  "find . -exec cat {} +",
  "find . -execdir rm {} ;",
  "git -c core.pager=cat log",
  "git -ccore.pager=x log",
  "git --config-env=core.pager=X log",
  "git --exec-path=/tmp diff",
  "git -C sub status",
  "git -C sub -c alias.x=!sh x",
  "git commit -c HEAD",
];

describe("checkCommand (main's port)", () => {
  it.each(COMMANDS)("agrees with lib's checkCommand on %j", (command) => {
    let lib: { argv: string[]; env: Record<string, string> } | "refused";
    try {
      lib = libCheck(command, ["TOKEN"]);
    } catch {
      lib = "refused";
    }
    let main: { argv: string[]; env: Record<string, string> } | "refused";
    try {
      main = checkCommand(command, ["TOKEN"]);
    } catch {
      main = "refused";
    }
    expect(main).toEqual(lib);
  });

  it("says why it refuses", () => {
    expect(() => checkCommand("")).toThrow("That command is empty.");
    expect(() => checkCommand("A=1")).toThrow("only sets variables");
    expect(() => checkCommand("timeout 5 node x")).toThrow("runs another command");
    expect(() => checkCommand("export")).toThrow("prints the environment");
    expect(() => checkCommand("node -e x")).toThrow("inline code");
    expect(() => checkCommand("npm exec -c x")).toThrow("npm exec -c runs a shell string.");
    expect(() => checkCommand("a;b")).toThrow("shell syntax");
    expect(() => checkCommand("npm run")).toThrow("control or invisible characters");
    expect(checkCommand("npm run job")).toEqual({ argv: ["npm", "run", "job"], env: {} });
  });

  it("splits and scans like a shell would", () => {
    expect(words("a 'b c' \"d\\\\e\" f\\")).toEqual(["a", "b c", "d\\e", "f"]);
    expect(shellSyntax("a \\; b")).toBeUndefined();
    expect(shellSyntax('a "b`c"')).toBe("`");
    expect(hasUnsafe("plain")).toBe(false);
  });
});
