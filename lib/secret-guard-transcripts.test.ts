import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { secretGuardFor } from "./secret-guard";
import { inCliProjects, isYolo, transcriptWrites, withoutTranscripts } from "./secret-guard-transcripts";

// YOLO opens the CLI's transcripts to read (2026-11-25): the hook reads the mode from its own input, so a switch counts
// on the next call, and only reads open.

let home: string;
const signal = new AbortController().signal;
const place = (file: string) => path.resolve("/p", file.replace(/^~(?=\/|$)/, home));

beforeAll(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-transcripts-")));
  fs.mkdirSync(path.join(home, ".claude", "projects", "-x"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "projects", "-x", "s.jsonl"), "{}");
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("the hook", () => {
  const pre = (file: string, permission_mode?: string): PreToolUseHookInput => ({
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_input: { file_path: file },
    tool_use_id: "t1",
    session_id: "s",
    transcript_path: "/t",
    cwd: "/p",
    permission_mode,
  });
  const denied = (out: unknown) => (out as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision === "deny";

  it("opens a transcript once the thread switches to YOLO, and seals it again when it switches back", async () => {
    const guard = secretGuardFor(() => "card");
    const file = path.join(home, ".claude", "projects", "-x", "s.jsonl");
    expect(denied(await guard(pre(file, "default"), "t1", { signal }))).toBe(true);
    expect(denied(await guard(pre(file, "bypassPermissions"), "t1", { signal }))).toBe(false);
    expect(denied(await guard(pre(file, "acceptEdits"), "t1", { signal }))).toBe(true);
    expect(denied(await guard(pre(file), "t1", { signal }))).toBe(true);
  });

  it("keeps the settings sealed in YOLO", async () => {
    const guard = secretGuardFor();
    expect(denied(await guard(pre(path.join(home, ".claude", "settings.json"), "bypassPermissions"), "t1", { signal }))).toBe(true);
  });
});

describe("helpers", () => {
  it("knows YOLO by its permission mode", () => {
    expect(isYolo("bypassPermissions")).toBe(true);
    expect(isYolo("default")).toBe(false);
    expect(isYolo(undefined)).toBe(false);
  });

  it("places the projects folder and what's in it, and nothing past it", () => {
    expect(inCliProjects(path.join(home, ".claude", "projects"))).toBe(true);
    expect(inCliProjects(path.join(home, ".claude", "projects", "-x", "s.jsonl"))).toBe(true);
    expect(inCliProjects(path.join(home, ".claude", "projects", "..", "settings.json"))).toBe(false);
    expect(inCliProjects(path.join(home, ".claude", "settings.json"))).toBe(false);
    expect(inCliProjects("")).toBe(false);
  });

  it("swaps transcript paths for stand-ins that keep their name", () => {
    expect(withoutTranscripts("cat ~/.claude/projects/-x/s.jsonl", place)).toBe("cat /tmp/transcripts/s.jsonl");
    expect(withoutTranscripts("ls ~/.claude/projects", place)).toBe("ls /tmp/transcripts/projects");
    expect(withoutTranscripts("cat /elsewhere/.claude/projects/a", place)).toBe("cat /elsewhere/.claude/projects/a");
    expect(withoutTranscripts("cat README.md", place)).toBe("cat README.md");
  });

  it.each([
    "cat README.md",
    "cat ~/.claude/projects/-x/s.jsonl | sort | uniq -c > /tmp/counts.txt",
    "sed -n 1,5p ~/.claude/projects/-x/s.jsonl",
    "sort ~/.claude/projects/-x/s.jsonl",
    "find ~/.claude/projects -name '*.jsonl'",
    "find ~/.claude/projects -name '*.jsonl' | xargs -n 1 wc -l",
    "cat ~/.claude/projects/-x/s.jsonl | tee /tmp/a.txt /tmp/b-$i.txt",
    "if [ -d ~/.claude/projects ]; then ls ~/.claude/projects; fi",
    "cat ~/.claude/projects/-x/s.jsonl | bash -c 'wc -l'",
    "eval 'cat ~/.claude/projects/-x/s.jsonl'",
    "env LC_ALL=C cat ~/.claude/projects/-x/s.jsonl",
    "python3 -c \"import sys; print(open(sys.argv[1]).read())\" ~/.claude/projects/-x/s.jsonl",
    "cat ~/.claude/projects/-x/s.jsonl > /tmp/out-$n.txt",
    "echo x > ~/.claude/projects/-x/memory/MEMORY.md",
    "find ~/.claude/projects -name '*.jsonl' | xargs -I {} jq -c . {}",
    "find ~/.claude/projects -name '*.jsonl' | xargs",
    "find ~/.claude/projects -name '*.jsonl' -print0 | xargs -0 cat",
    "find ~/.claude/projects -name '*.jsonl' -exec head -1 {} + -exec wc -l {} +",
    "find ~/.claude/projects -name '*.jsonl' -exec head -1 {}",
    "cat ~/.claude/projects/-x/s.jsonl | bash -c",
    "ls ~/.claude/projects; { }",
    "cat ~/.claude/projects/-x/s.jsonl; cp",
  ])("lets `%s` through", (command) => expect(transcriptWrites(command, place)).toBeNull());

  it.each([
    "sort -o ~/.claude/projects/-x/s.jsonl ~/.claude/projects/-x/s.jsonl",
    "find ~/.claude/projects -fprint /tmp/x",
    "cp -t ~/.claude/projects/-x /tmp/a",
    "mkdir ~/.claude/projects/-y",
    'cat ~/.claude/projects/-x/s.jsonl > "$out"',
    "eval 'rm ~/.claude/projects/-x/s.jsonl'",
    "python3 -c \"from pathlib import Path; Path('~/.claude/projects/-x/s.jsonl').write_text('')\"",
    "perl -ne print ~/.claude/projects/-x/s.jsonl",
    "chmod 777 ~/.claude/projects/-x/s.jsonl",
  ])("turns `%s` away as a write", (command) => expect(transcriptWrites(command, place)).toContain("stays sealed in every mode"));

  it("turns away a heredoc of writes piped to a shell", () => {
    expect(transcriptWrites("cat ~/.claude/projects/-x/s.jsonl; bash <<'EOF'\nrm ~/.claude/projects/-x/s.jsonl\nEOF", place)).toContain("stays sealed");
  });

  it("stops past five shells deep", () => {
    expect(transcriptWrites("rm ~/.claude/projects/-x/s.jsonl", place, 6)).toBeNull();
  });
});
