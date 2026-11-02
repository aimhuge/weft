import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { captureAiGeneration } from "./ai-observability";
import { projectRoot } from "./quality";
import { scoutPrompt } from "./scout-prompt";
import { parseFindings, type ScoutReport, type ScoutState } from "./scout-view";
import { SECRET_GUARD_HOOKS } from "./secret-guard";
import { DATA_DIR } from "./store";

// The refactor scout: a read-only Sonnet run that reads a project and lists concrete improvements the
// checklist in lib/quality.ts can't see. Cached per project with the commit it ran on. It runs on its own
// only for a project with no report yet; after that, /weft:done's scout (scout-save.mjs) and "Re-scout"
// refresh it. Never on the start-a-card path (SOUL.md: speed first), and never just because HEAD moved.

const DIR = path.join(DATA_DIR, "scout");
const MAX_TURNS = 40;

const running = new Map<string, Promise<void>>();
const errors = new Map<string, string>();

export { scoutPrompt };

export function scoutFile(root: string) {
  return path.join(DIR, `${createHash("sha1").update(root).digest("hex").slice(0, 16)}.json`);
}

export function headCommit(root: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function readScout(root: string): ScoutReport | null {
  try {
    return JSON.parse(fs.readFileSync(scoutFile(root), "utf8")) as ScoutReport;
  } catch {
    return null;
  }
}

function writeScout(report: ScoutReport) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(scoutFile(report.root), JSON.stringify(report, null, 2));
}

async function scout(root: string) {
  let text = "";
  const prompt = scoutPrompt();
  const traceId = randomUUID();
  const startedAt = Date.now();
  for await (const msg of query({
    prompt,
    options: {
      model: "sonnet",
      cwd: root,
      tools: ["Read", "Grep", "Glob"],
      allowedTools: ["Read", "Grep", "Glob"],
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      // It reads the whole project, .env files included unless turned away.
      hooks: SECRET_GUARD_HOOKS,
      maxTurns: MAX_TURNS,
    },
  })) {
    if (msg.type !== "result") continue;
    const usage = "usage" in msg ? msg.usage : undefined;
    await captureAiGeneration({
      sessionId: null,
      traceId,
      spanName: "refactor_scout",
      model: "sonnet",
      input: prompt,
      output: msg.subtype === "success" ? msg.result : undefined,
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
      cacheReadInputTokens: usage?.cache_read_input_tokens,
      cacheCreationInputTokens: usage?.cache_creation_input_tokens,
      latencyMs: Date.now() - startedAt,
      isError: msg.subtype !== "success",
      error: msg.subtype !== "success" ? msg.subtype : undefined,
      stream: true,
    });
    if (msg.subtype !== "success") throw new Error(`The scout stopped: ${msg.subtype}`);
    text = msg.result;
  }
  const findings = parseFindings(text);
  if (!findings.length) throw new Error("The scout returned no findings");
  const previous = readScout(root);
  const ids = new Set(findings.map((f) => f.id));
  writeScout({
    root,
    commit: headCommit(root),
    ranAt: Date.now(),
    findings,
    // A finding handed to a card stays marked while the scout still sees it.
    started: (previous?.started ?? []).filter((id) => ids.has(id)),
  });
}

// Starts a run for the project unless one is going. Resolves when it ends; never rejects.
export function startScout(root: string): Promise<void> {
  const going = running.get(root);
  if (going) return going;
  errors.delete(root);
  const run = scout(root)
    .catch((err: unknown) => {
      errors.set(root, err instanceof Error ? err.message : String(err));
    })
    .finally(() => running.delete(root));
  running.set(root, run);
  return run;
}

// The badge's read: the cached report, starting a run in the background when there's none yet or it's asked for.
export function scoutState(cwd: string, { force = false } = {}): ScoutState {
  const root = projectRoot(cwd);
  const report = readScout(root);
  if (force || (!report && !errors.has(root))) void startScout(root);
  const error = errors.get(root);
  return { report, running: running.has(root), ...(error ? { error } : {}) };
}

// Marks a finding as handed to a card.
export function markStarted(cwd: string, id: string) {
  const report = readScout(projectRoot(cwd));
  if (report && !report.started.includes(id)) writeScout({ ...report, started: [...report.started, id] });
}
