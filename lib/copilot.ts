import os from "node:os";
import { reapStrayClis } from "./cli-reaper";
import { startWorkerReaper } from "./worker-reaper";
import { startSessionSync } from "./import";
import { startSearchIndex } from "./search";
import { boardDigest, lastSeen, rememberSeen, snapshot, withDigest } from "./copilot-digest";
import { startHookListener } from "./github-hooks";
import { startVercelListener } from "./vercel-hooks";
import { startWebhookRelay } from "./webhook-forward";
import { startAccountCloudSync } from "./cloud-sync-start";
import { startBlastcpAuto } from "./blastcp-auto";
import { startKeychainAuditSync } from "./keychain-audit-sync";
import { consumeServerExit } from "./crash-blame";
import { startLeagueSync } from "./league-sync";
import { startIssueSync } from "./github-issues";
import { startProjectSeed } from "./project-seed-run";
import { startVercelDrift } from "./vercel-drift-open";
import { startSlack } from "./slack";
import { startPukuTrial } from "./puku-trial";
import { endSession, ensureSpare, retryPukuWithTrial, sendUserMessage, warmUp } from "./runner";
import { resumeInterrupted } from "./resume";
import { startScheduler } from "./scheduler";
import { chipCardId, startSuggestRefresh } from "./copilot-suggest";
import { startCheckIns } from "./copilot-initiative-run";
import { isBusy } from "./runner-state";
import type { CopilotPersona } from "./copilot-personas";
import { backendFor, modelFor } from "./new-thread";
import { fallbackFor } from "./model-fallback";
import { copilotModel, defaultPermissionMode, listProjects } from "./settings";
import { clearThread, createCard, getCard, listCards, updateCard } from "./store";
import { COPILOT_ID } from "./types";

// The model the copilot card should be created with: Settings → Models → Copilot's pick, or the user's
// last-picked model when that says "default". Set once when the card is first made; the user
// changes the model again by editing the pick and starting a new chat.
// A model that has hit its limit is replaced by the backup model, so the copilot starts on one
// that can actually answer.
function copilotInitialModel() {
  const picked = copilotModel();
  const wanted = picked || modelFor("claude");
  return fallbackFor(wanted)?.model ?? (wanted || undefined);
}

// The CLI the copilot starts on: the one that serves its model. Every model is offered in the
// picker, so the copilot may run on Claude, Puku or Codex.
function copilotBackend(model: string | undefined) {
  return (model && backendFor(model)) || "claude";
}

export function ensureCopilot() {
  // The model is worked out once: the pick and the CLI it runs on have to agree.
  const model = copilotInitialModel();
  return (
    getCard(COPILOT_ID) ??
    createCard(
      {
        title: "Copilot",
        prompt: "",
        cwd: os.homedir(),
        backend: copilotBackend(model),
        permissionMode: defaultPermissionMode(),
        model,
        role: "copilot",
      },
      COPILOT_ID,
    )
  );
}

// A message you typed to the copilot. Its CLI also gets what finished, needs you or failed on the
// board since your last message, and, for a suggested chip about a card, which card; the thread shows only your text.
export function sendToCopilot(text: string) {
  const cards = listCards();
  const digest = boardDigest(cards, lastSeen(), getCard(COPILOT_ID)?.lastWeftTurn);
  const about = chipCardId(text);
  const card = about ? getCard(about) : undefined;
  const note = card ? `[Weft: this is a suggested chip about card "${card.title}" (${card.id}); read_thread it before acting. Not written by the user.]` : "";
  sendUserMessage(COPILOT_ID, text, { cli: withDigest([digest, note].filter(Boolean).join("\n\n"), text) });
  rememberSeen(snapshot(cards));
}

// Starts a fresh conversation: closes the CLI and forgets the session.
export async function resetCopilot() {
  ensureCopilot();
  await endSession(COPILOT_ID);
  clearThread(COPILOT_ID);
  const card = updateCard(COPILOT_ID, {
    sessionId: undefined,
    column: "backlog",
    costUsd: 0,
    turns: 0,
    lastLine: undefined,
    error: undefined,
    pending: null,
  });
  warmUp(COPILOT_ID);
  return card;
}

// Makes the copilot another persona (lib/copilot-personas.ts). Its CLI reads the persona's prompt only when it
// starts, so this starts a new chat; the old persona's conversation isn't kept.
export async function setCopilotPersona(persona: CopilotPersona) {
  ensureCopilot();
  updateCard(COPILOT_ID, { persona: persona === "wingman" ? undefined : persona });
  return resetCopilot();
}

// Every project folder and card folder Weft knows: where the reapers may end orphans.
function weftFolders() {
  return [...new Set([...listProjects().map((p) => p.path), ...listCards().map((c) => c.cwd)].filter(Boolean))];
}

const g = globalThis as unknown as { __weftPrewarmed?: boolean };

// Once per server start: open the copilot's CLI and a spare in the most recent project, so the
// first message to either doesn't wait for a CLI to start.
export function prewarm() {
  if (g.__weftPrewarmed) return;
  g.__weftPrewarmed = true;
  // End the thread CLIs a server that died without cleaning up left orphaned (lib/cli-reaper.ts).
  reapStrayClis(weftFolders()).catch((err: unknown) => console.error("[weft] stray CLI check failed:", err));
  // And, every few minutes, the vitest workers a killed test run left under PID 1 (lib/worker-reaper.ts).
  startWorkerReaper(weftFolders);
  // Pick up the user's existing Claude Code sessions as cards, and keep them in sync.
  startSessionSync();
  startSearchIndex();
  // Send the messages queued for a set time (lib/scheduler.ts), including any that came due while closed.
  startScheduler();
  // Run the crons whose time has come (lib/cron-run.ts), one new card per run. Loaded after the board's own start.
  void import("./cron-run").then((m) => m.startCronClock(), (err: unknown) => console.error("[weft] cron clock failed to start:", err));
  // Sync the GitHub issues of the folders that opted in, every 5 minutes (lib/github-issues.ts).
  startIssueSync();
  // Park a few starter cards in a project's Backlog the first time it lands on the board (lib/project-seed-run.ts).
  startProjectSeed();
  // Line a newly opened project's 🔐 vault up against its Vercel env, in the background (lib/vercel-drift-open.ts).
  startVercelDrift();
  // Hear webhook-relayed issue events within seconds, while you're signed in to Weft (lib/github-hooks.ts).
  startHookListener();
  // Pull new Vercel env variables into the 🔐 vault as their webhook events arrive (lib/vercel-hooks.ts).
  startVercelListener();
  // Forward what providers post to your webhooks' relay URLs to their local targets (lib/webhook-forward.ts).
  startWebhookRelay();
  // Upload the cards and threads of the folders that opted in to your workspace (lib/cloud-sync.ts).
  startAccountCloudSync();
  // Give a signed-in Weft user a BlastCP account and connect the drawer, no browser (lib/blastcp-auto.ts).
  startBlastcpAuto();
  // Upload the Keychain audit log to your Weft account while you're signed in (lib/keychain-audit-sync.ts).
  startKeychainAuditSync();
  // Post your week to your league while you are signed in to Weft (lib/league-sync.ts).
  startLeagueSync();
  // Keep Weft's Puku trial token fresh, and give puku threads waiting on a login the trial when you sign in to Weft.
  startPukuTrial(() => void retryPukuWithTrial());
  // Keep the copilot's board-made chips fresh as cards move (lib/copilot-suggest.ts).
  startSuggestRefresh();
  // Let the copilot speak first: a morning idea, and a refactor look after work lands (lib/copilot-initiative.ts).
  startCheckIns(() => isBusy(COPILOT_ID));
  // Post commits, pushes, deploys and card status to the Slack drawer's channel (lib/slack.ts).
  startSlack();
  // Build every app folder on save (lib/app-build-watch.ts). Loaded lazily and never awaited: esbuild must stay off every
  // route's import path, and a watcher that fails to start logs a line instead of taking the server down.
  void import("./app-build-watch")
    .then((m) => m.startAppBuildWatcher())
    .catch((err: unknown) => console.error(`app-build-watch: not started: ${err instanceof Error ? err.message : String(err)}`));
  // Keep isolated cards' worktree pools fresh (lib/worktree-pool.ts); loaded lazily, so git stays off this import path.
  void import("./worktree-pool").then((m) => m.startWorktreePool()).catch(() => {});
  // Name the card whose tool call stopped the last server, before its turn is carried on (lib/crash-blame.ts).
  consumeServerExit();
  // Carry on the turns the last quit cut off (lib/resume.ts).
  resumeInterrupted();
  ensureCopilot();
  warmUp(COPILOT_ID);
  const recent = listProjects()[0]?.path ?? listCards().find((c) => c.role !== "copilot")?.cwd;
  if (recent) ensureSpare(recent);
}
