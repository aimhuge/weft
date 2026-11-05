import { describe, expect, it } from "vitest";
import { normalizeForRisk, phoneOnly, phoneOnlyAllow } from "./passkey-phone-only";

const bash = (command: string) => phoneOnly({ toolName: "Bash", input: { command } });
const write = (file_path: string, content = "x") => phoneOnly({ toolName: "Write", input: { file_path, content } });

describe("normalizeForRisk", () => {
  it("strips quotes, backslashes and $'' escapes, and collapses whitespace", () => {
    expect(normalizeForRisk(`claude --dangerously-'skip'-"permissions"`)).toBe("claude --dangerously-skip-permissions");
    expect(normalizeForRisk("claude --danger\\ously-skip-permissions")).toBe("claude --dangerously-skip-permissions");
    expect(normalizeForRisk("codex $'--yolo'\n\t  x")).toBe("codex --yolo x");
    expect(normalizeForRisk("BypassPermissions")).toBe("bypasspermissions");
  });
});

describe("phoneOnly", () => {
  it("keeps vault tools on the phone or the Mac", () => {
    expect(phoneOnly({ toolName: "mcp__secrets__fill_field", input: {} })).toBe(true);
  });

  it("catches skipping permissions however it's spelled, across Claude Code, Codex and Goose", () => {
    expect(bash("claude --dangerously-skip-permissions")).toBe(true);
    expect(bash(`claude --dangerously-'skip'-permissions -p hi`)).toBe(true);
    expect(bash("claude --danger\\ously-skip-permissions")).toBe(true);
    expect(bash("claude --allow-dangerously-skip-permissions")).toBe(true);
    expect(phoneOnly({ toolName: "mcp__board__x", input: { mode: "bypassPermissions" } })).toBe(true);
    expect(phoneOnly({ toolName: "mcp__board__x", input: { nested: { mode: "bypassPermissions" } } })).toBe(true);
    expect(bash("codex --yolo exec hi")).toBe(true);
    expect(bash("codex --dangerously-bypass-approvals-and-sandbox")).toBe(true);
    expect(bash("codex -s danger-full-access")).toBe(true);
    expect(bash("codex --sandbox=danger-full-access")).toBe(true);
  });

  it("catches writes to an agent's config, hooks and MCP servers", () => {
    expect(write("/Users/a/app/.claude/settings.json")).toBe(true);
    expect(write("~/.codex/config.toml")).toBe(true);
    expect(write(".goose/config.yaml")).toBe(true);
    expect(write("/w/app/settings.local.json")).toBe(true);
    expect(write("/w/app/.mcp.json")).toBe(true);
    expect(write("/w/app/.git/hooks/pre-commit")).toBe(true);
    expect(bash("git config core.hooksPath /tmp/h")).toBe(true);
    expect(bash(`echo '{"permissions":{"allow":["Bash"]}}' > config/settings.dev.json`)).toBe(true);
    expect(bash(`cat > settings.json <<EOF\n{"defaultMode":"x"}\nEOF`)).toBe(true);
  });

  it("catches a config folder with no slash, a variable-built path, and escaped hook config", () => {
    expect(bash("cd .claude && rm -rf commands")).toBe(true);
    expect(bash("cp x ~/.codex")).toBe(true);
    expect(bash("ls .goose")).toBe(true);
    expect(write("/Users/a/.claude.json")).toBe(true);
    expect(bash('cp evil "${CFG}/claude/agents.md"')).toBe(true);
    expect(bash("echo x > $(echo ~)/claude-config")).toBe(true);
    expect(bash("cat codex.md > ${OUT}")).toBe(true);
    expect(bash("printf '[core]\\n\\thooksPath = /tmp/h' >> .git/config")).toBe(true);
  });

  it("catches approvals switched off", () => {
    expect(bash("codex -a never exec x")).toBe(true);
    expect(bash("codex --ask-for-approval=never")).toBe(true);
    expect(bash("codex -c approval_policy=never")).toBe(true);
    expect(bash('codex -c approval_policy="never"')).toBe(true);
    expect(bash("codex --full-auto")).toBe(true);
    expect(bash('claude --allowedTools "Bash(*)" -p go')).toBe(true);
    expect(bash("claude --allowed-tools '*'")).toBe(true);
    expect(bash("GOOSE_MODE=auto goose run")).toBe(true);
  });

  it("lets everyday asks through", () => {
    expect(bash("ls -la")).toBe(false);
    expect(bash("pnpm test lib/x.test.ts")).toBe(false);
    expect(write("/w/app/lib/settings.ts")).toBe(false);
    expect(write("/w/app/settings.json", '{"theme":"dark"}')).toBe(false);
    expect(write("/w/app/my.claude/notes.md")).toBe(false);
    expect(bash('echo "$HOME" && ls')).toBe(false);
    expect(bash('claude --allowedTools "Read" -p go')).toBe(false);
    expect(bash("codex -a on-request exec x")).toBe(false);
  });
});

describe("phoneOnlyAllow", () => {
  const risky = { toolName: "Bash", input: { command: "codex --yolo" } };
  it("is an Allow on a phone-only permission request, and nothing else", () => {
    expect(phoneOnlyAllow(risky, true)).toBe(true);
    expect(phoneOnlyAllow(risky, false)).toBe(false);
    expect(phoneOnlyAllow({ toolName: "Bash", input: { command: "ls" } }, true)).toBe(false);
    expect(phoneOnlyAllow(null, true)).toBe(false);
    expect(phoneOnlyAllow({ ...risky, questions: [{ question: "?" }] as never }, true)).toBe(false);
    expect(phoneOnlyAllow({ ...risky, elicitation: {} as never }, true)).toBe(false);
  });
  it("reads a request off the wire with fields missing as nothing to run, or no input", () => {
    expect(phoneOnlyAllow({} as never, true)).toBe(false);
    expect(phoneOnlyAllow({ toolName: "mcp__secrets__run" } as never, true)).toBe(true);
  });
});
