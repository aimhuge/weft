import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cliAnswer, hookCommand, UNANSWERED } from "./answer";
import { GUARD_TOKEN_ENV, GUARD_URL_ENV } from "./turn";

// What Weft's guard route answers a Codex or Goose turn in that CLI's own words (lib/guards/answer.ts), and the hook
// command that asks the route at all — run for real here, with a fake curl standing in for the server.

describe("cliAnswer", () => {
  it("lets a Goose call through with an allow, and blocks it with a reason", () => {
    expect(cliAnswer("goose", "PreToolUse", { allow: true })).toEqual({ decision: "allow" });
    expect(cliAnswer("goose", "PostToolUse", { allow: true })).toEqual({ decision: "allow" });
    expect(cliAnswer("goose", "PreToolUse", { allow: false, reason: "no" })).toEqual({ decision: "block", reason: "no" });
    expect(cliAnswer("goose", "PostToolUse", { allow: false, reason: "no" })).toEqual({ decision: "block", reason: "no" });
  });

  it("turns a Codex call away before it runs, with the reason in the hook's own words", () => {
    expect(cliAnswer("codex", "PreToolUse", { allow: false, reason: "not that way" })).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "not that way" },
    });
  });

  it("blocks a Codex call that already ran, with the reason in the hook's own words", () => {
    expect(cliAnswer("codex", "PostToolUse", { allow: false, reason: "not that way" })).toEqual({ decision: "block", reason: "not that way" });
    expect(cliAnswer("codex", "PostToolUseFailure", { allow: false, reason: "not that way" })).toEqual({ decision: "block", reason: "not that way" });
  });

  it("says nothing to Codex before a call when the guards let it go", () => {
    expect(cliAnswer("codex", "PreToolUse", { allow: true })).toEqual({});
    expect(cliAnswer("codex", "PreToolUse", { allow: true, context: "one card owns this." })).toEqual({});
    expect(cliAnswer("codex", "PreToolUse", { allow: true, feedback: "the import broke." })).toEqual({});
  });

  it("tells Codex what to do about a call that already ran", () => {
    expect(cliAnswer("codex", "PostToolUse", { allow: true })).toEqual({});
    expect(cliAnswer("codex", "PostToolUse", { allow: true, feedback: "the import broke." })).toEqual({ decision: "block", reason: "the import broke." });
    expect(cliAnswer("codex", "PostToolUse", { allow: true, context: "one card owns this." })).toEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "one card owns this." },
    });
  });

  it("tells Codex both what to do and what to know, when a call that ran needs both", () => {
    expect(cliAnswer("codex", "PostToolUse", { allow: true, context: "one card owns this.", feedback: "the import broke." })).toEqual({
      decision: "block",
      reason: "the import broke.",
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "one card owns this." },
    });
  });
});

describe("the hook command", () => {
  it("posts the call to Weft's guard route with the turn's token", () => {
    const command = hookCommand("codex", "PreToolUse");
    expect(command).toContain(`$${GUARD_URL_ENV}/codex/PreToolUse`);
    expect(command).toContain(`$${GUARD_TOKEN_ENV}`);
    expect(command).toContain("Authorization: Bearer");
    expect(command).toContain("Content-Type: application/json");
    expect(command).toContain("--data-binary @-");
  });

  it("writes the route and the token in when a CLI's shell would show its env", () => {
    const command = hookCommand("goose", "PostToolUse", { url: "http://127.0.0.1:1234/api/guards", token: "abc123" });
    expect(command).toContain('"http://127.0.0.1:1234/api/guards/goose/PostToolUse"');
    expect(command).toContain("Authorization: Bearer abc123");
    expect(command).not.toContain(`$${GUARD_URL_ENV}`);
    expect(command).not.toContain(`$${GUARD_TOKEN_ENV}`);
  });
});

// The hook command, run for real: a fake curl in a directory of its own, which records what it was asked and answers
// as Weft's server would (or doesn't).
describe("the hook command, run", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-guard-answer-"));
  const bin = path.join(dir, "bin");
  const argvFile = path.join(dir, "argv.txt");
  const stdinFile = path.join(dir, "stdin.txt");
  fs.mkdirSync(bin);
  const curl = path.join(bin, "curl");
  // The fake curl: it takes what it was given, reads the call on stdin, and answers as told.
  const write = (script: string) => {
    fs.writeFileSync(curl, script, { mode: 0o755 });
    fs.rmSync(argvFile, { force: true });
    fs.rmSync(stdinFile, { force: true });
  };
  const fakeCurl = (body: string, exit = 0) => `#!/bin/sh
printf '%s\\n' "$@" > ${argvFile}
cat > ${stdinFile}
printf '%s' ${JSON.stringify(body)}
exit ${exit}
`;
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, [GUARD_TOKEN_ENV]: "tok-123", [GUARD_URL_ENV]: "http://127.0.0.1:9999/api/guards" };

  const run = (command: string) => execFileSync("/bin/sh", ["-c", command], { env, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });

  afterEach(() => {
    fs.rmSync(argvFile, { force: true });
    fs.rmSync(stdinFile, { force: true });
  });

  it("prints what the route answered", () => {
    write(fakeCurl('{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'));
    expect(run(hookCommand("codex", "PreToolUse"))).toBe('{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n');
  });

  it("refuses a Codex call it couldn't check", () => {
    // curl fails the way a server that isn't there fails: with an error and nothing on stdout.
    write(fakeCurl("", 22));
    const out = run(hookCommand("codex", "PreToolUse"));
    const answer = JSON.parse(out) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
    expect(answer.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(answer.hookSpecificOutput.permissionDecisionReason).toBe(UNANSWERED);
  });

  it("refuses a Goose call it couldn't check", () => {
    write(fakeCurl("", 22));
    const answer = JSON.parse(run(hookCommand("goose", "PreToolUse"))) as { decision: string; reason: string };
    expect(answer.decision).toBe("block");
    expect(answer.reason).toBe(UNANSWERED);
  });

  it("changes nothing about a call that already ran when it couldn't check it", () => {
    write(fakeCurl("", 22));
    expect(run(hookCommand("codex", "PostToolUse"))).toBe("{}\n");
    expect(run(hookCommand("goose", "PostToolUse"))).toBe('{"decision":"allow"}\n');
  });

  it("prints the body the route answered with", () => {
    write(fakeCurl("hello from Weft"));
    expect(run(hookCommand("codex", "PostToolUse"))).toBe("hello from Weft\n");
  });

  it("sends the turn's token and the route's address, and the call on stdin", () => {
    write(fakeCurl("{}"));
    run(hookCommand("codex", "PreToolUse"));
    const argv = fs.readFileSync(argvFile, "utf8").split("\n");
    expect(argv).toContain("Authorization: Bearer tok-123");
    expect(argv).toContain("http://127.0.0.1:9999/api/guards/codex/PreToolUse");
    expect(fs.readFileSync(stdinFile, "utf8")).toBe("");
  });

  it("sends the route and the token written in, when the CLI's shell would show its env", () => {
    write(fakeCurl("{}"));
    run(hookCommand("goose", "PostToolUse", { url: "http://127.0.0.1:4321/api/guards", token: "tok-xyz" }));
    const argv = fs.readFileSync(argvFile, "utf8").split("\n");
    expect(argv).toContain("Authorization: Bearer tok-xyz");
    expect(argv).toContain("http://127.0.0.1:4321/api/guards/goose/PostToolUse");
  });

  it("keeps a reason with a quote in it, out of the shell's way", () => {
    write(fakeCurl("", 22));
    const out = run(hookCommand("codex", "PreToolUse", { url: "http://127.0.0.1:4321/api/guards", token: "tok-xyz" }));
    const answer = JSON.parse(out) as { hookSpecificOutput: { permissionDecisionReason: string } };
    expect(answer.hookSpecificOutput.permissionDecisionReason).toBe(UNANSWERED);
  });
});
