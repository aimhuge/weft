// The `run` command: "run this on that Weft Worker" (docs/architecture/weft-worker.md#the-command-protocol). The
// board builds the row (runCommand), the worker reads it back (runBody); both live here so the two can't drift.
// A run is a new card with two things a Mac's new_card doesn't carry: the repo to clone when the worker has no
// checkout yet, and the mode the thread starts in (never one that skips asking).
import type { NewCardPayload, NewCommand, CloudCommandRow } from "./cloud-commands";
import { CLAUDE_TOKEN, GITHUB_PURPOSE, GITHUB_TOKEN, LOGIN_PURPOSE, seal } from "./worker-seal";

// The modes a run may ask for. bypassPermissions is left out on purpose: a command off the network can't buy a
// thread that runs without asking.
export const RUN_MODES = ["default", "acceptEdits", "auto", "plan"] as const;
export type RunMode = (typeof RUN_MODES)[number];

// The modes a running card may switch to, from its thread's picker. Never bypassPermissions, for the same reason.
export const CARD_MODES = ["default", "acceptEdits", "auto"] as const;
export type CardMode = (typeof CARD_MODES)[number];

// A click or drag on a worker's live screen, as fractions of the screen (components/web-board/WorkerScreen.tsx).
export type ScreenInput = { kind: "tap" | "swipe"; device: string; x: number; y: number; x2?: number; y2?: number; ms?: number };

export interface RunPayload extends NewCardPayload {
  // A git URL to clone into the worker's work folder when the folder isn't there yet.
  repo?: string;
  permissionMode?: RunMode;
}

// A worker's device id, the target_device a command names (public.cloud_workers, `worker:<id>`).
export const workerDevice = (workerId: string) => `worker:${workerId}`;
export const isWorkerDevice = (device: string) => device.startsWith("worker:");

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

// The row the board inserts to run a prompt on a worker, or null when there's nothing to run. folder is the
// project's name on the worker (its folder under the work root), not a path on this Mac.
export function runCommand(target: { orgId: string; workerId: string; folder: string }, body: { prompt: string; repo?: string; model?: string; permissionMode?: string }): NewCommand | null {
  const prompt = body.prompt.trim();
  const folder = target.folder.trim();
  if (!prompt || !folder) return null;
  const payload: RunPayload = { prompt };
  if (text(body.repo)) payload.repo = text(body.repo);
  if (text(body.model)) payload.model = text(body.model);
  const mode = RUN_MODES.find((m) => m === body.permissionMode);
  if (mode) payload.permissionMode = mode;
  return { org_id: target.orgId, kind: "run", target_device: workerDevice(target.workerId), folder, payload };
}

// A run as the worker reads it off the network: only the fields a card is made from, each the type it must be.
export function runBody(command: Pick<CloudCommandRow, "payload">): RunPayload | null {
  const raw: unknown = command.payload;
  const p: Partial<Record<keyof RunPayload, unknown>> = raw && typeof raw === "object" ? raw : {};
  const prompt = text(p.prompt);
  if (!prompt) return null;
  const out: RunPayload = { prompt };
  for (const key of ["title", "model", "repo"] as const) {
    const value = text(p[key]);
    if (value) out[key] = value;
  }
  const backend = text(p.backend);
  if (backend === "claude" || backend === "codex" || backend === "puku" || backend === "goose") out.backend = backend;
  const effort = text(p.effort);
  if (effort) out.effort = effort as RunPayload["effort"];
  const mode = RUN_MODES.find((m) => m === p.permissionMode);
  if (mode) out.permissionMode = mode;
  if (Array.isArray(p.tags)) out.tags = p.tags.filter((t): t is string => typeof t === "string");
  return out;
}

// The `login` command: a Claude Code token sealed to one worker's public key (lib/worker-seal.ts), so the row every
// member of the workspace can read holds nothing they can use. folder is unused; the column wants a value.
export function loginCommand(target: { orgId: string; workerId: string; publicKey: string }, token: string): NewCommand | null {
  const clean = token.trim();
  if (!CLAUDE_TOKEN.test(clean)) return null;
  return { org_id: target.orgId, kind: "login", target_device: workerDevice(target.workerId), folder: "-", payload: { token: seal(target.publicKey, clean, LOGIN_PURPOSE) } };
}

// The `update` command: Settings → Sync → Workers' Update now. It carries nothing, so it can only ask for the check the
// worker runs by itself. folder is unused; the column wants a value.
export const updateCommand = (target: { orgId: string; workerId: string }): NewCommand => ({ org_id: target.orgId, kind: "update", target_device: workerDevice(target.workerId), folder: "-", payload: {} });

// The `github_login` command: a GitHub token sealed the same way, with its own purpose.
export function githubLoginCommand(target: { orgId: string; workerId: string; publicKey: string }, token: string): NewCommand | null {
  const clean = token.trim();
  if (!GITHUB_TOKEN.test(clean)) return null;
  return { org_id: target.orgId, kind: "github_login", target_device: workerDevice(target.workerId), folder: "-", payload: { token: seal(target.publicKey, clean, GITHUB_PURPOSE) } };
}

// The `clone` command: put a GitHub repo on a worker with no thread. folder is the repo's name, the same project
// name a run uses, so a later run finds the checkout. Null for anything but owner/name.
export function cloneCommand(target: { orgId: string; workerId: string }, slug: string): NewCommand | null {
  const clean = slug.trim();
  const [, name] = clean.split("/");
  if (!/^[\w.-]+\/[\w.-]+$/.test(clean) || !name || name.startsWith(".")) return null;
  return { org_id: target.orgId, kind: "clone", target_device: workerDevice(target.workerId), folder: name, payload: { repo: `https://github.com/${clean}.git` } };
}

// The repo a clone names, as the worker reads it off the network.
export function cloneBody(command: Pick<CloudCommandRow, "payload">): string | null {
  const raw: unknown = command.payload;
  return raw && typeof raw === "object" ? (text((raw as { repo?: unknown }).repo) ?? null) : null;
}

type CardTarget = { orgId: string; device: string; folder: string; cardId: string };

const cardIdOf = (payload: unknown) => text(payload && typeof payload === "object" ? (payload as { cardId?: unknown }).cardId : undefined);

// The `mode` command: the thread's mode picker on a worker's card. Null for a mode a card can't be sent to.
export function modeCommand(target: CardTarget, mode: unknown): NewCommand | null {
  const allowed = CARD_MODES.find((m) => m === mode);
  if (!allowed) return null;
  return { org_id: target.orgId, kind: "mode", target_device: target.device, folder: target.folder, payload: { cardId: target.cardId, mode: allowed } };
}

// A mode as the worker reads it off the network, held to the same list: a row can't buy a mode the picker doesn't offer.
export function modeBody(command: Pick<CloudCommandRow, "payload">): { cardId: string; mode: CardMode } | null {
  const cardId = cardIdOf(command.payload);
  const mode = CARD_MODES.find((m) => m === (command.payload as { mode?: unknown } | null)?.mode);
  return cardId && mode ? { cardId, mode } : null;
}

const fraction = (v: unknown) => typeof v === "number" && Number.isFinite(v);

function screenInput(raw: unknown): ScreenInput | null {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof ScreenInput, unknown>>;
  const device = text(p.device);
  if ((p.kind !== "tap" && p.kind !== "swipe") || !device || !fraction(p.x) || !fraction(p.y)) return null;
  const point = { device, x: p.x as number, y: p.y as number };
  if (p.kind === "tap") return { kind: "tap", ...point };
  if (!fraction(p.x2) || !fraction(p.y2)) return null;
  return { kind: "swipe", ...point, x2: p.x2 as number, y2: p.y2 as number, ...(fraction(p.ms) ? { ms: p.ms as number } : {}) };
}

// The `input` command: a tap or swipe on a worker's device. A command, not a message on the frames' public channel,
// so only the account the worker obeys can touch the device.
export function inputCommand(target: CardTarget, input: unknown): NewCommand | null {
  const clean = screenInput(input);
  if (!clean) return null;
  return { org_id: target.orgId, kind: "input", target_device: target.device, folder: target.folder, payload: { cardId: target.cardId, ...clean } };
}

export function inputBody(command: Pick<CloudCommandRow, "payload">): { cardId: string; input: ScreenInput } | null {
  const cardId = cardIdOf(command.payload);
  const input = screenInput(command.payload);
  return cardId && input ? { cardId, input } : null;
}
