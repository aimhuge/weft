// A tap, a swipe or a Start on a worker's live screen (components/web-board/WorkerScreen.tsx), as the `input` row the
// worker reads. Plain data, no Node: weft.zip builds these rows in the browser (components/web-board/WebBoard.tsx), and
// lib/worker-commands.ts reads them back on the worker with the sealed offer added (which only a Mac seals).
import type { NewCommand } from "./cloud-commands";

export type PlainScreenInput =
  | { kind: "tap" | "swipe"; device: string; x: number; y: number; x2?: number; y2?: number; ms?: number }
  | { kind: "watch"; device?: string };

export type RawInput = Partial<Record<"kind" | "device" | "x" | "y" | "x2" | "y2" | "ms" | "sealed", unknown>>;

export const inputText = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const fraction = (v: unknown) => typeof v === "number" && Number.isFinite(v);

function touchInput(p: RawInput, device: string): PlainScreenInput | null {
  if ((p.kind !== "tap" && p.kind !== "swipe") || !fraction(p.x) || !fraction(p.y)) return null;
  const point = { device, x: p.x as number, y: p.y as number };
  if (p.kind === "tap") return { kind: "tap", ...point };
  if (!fraction(p.x2) || !fraction(p.y2)) return null;
  return { kind: "swipe", ...point, x2: p.x2 as number, y2: p.y2 as number, ...(fraction(p.ms) ? { ms: p.ms as number } : {}) };
}

// A tap, swipe or watch off the network, each field the type it must be; null for anything else (an offer included).
export function plainScreenInput(raw: unknown): PlainScreenInput | null {
  const p = (raw && typeof raw === "object" ? raw : {}) as RawInput;
  const device = inputText(p.device);
  if (p.kind === "watch") return device ? { kind: "watch", device } : { kind: "watch" };
  return device ? touchInput(p, device) : null;
}

export type CardTarget = { orgId: string; device: string; folder: string; cardId: string };

// The `input` row for a card's worker.
export function inputRow(target: CardTarget, input: object): NewCommand {
  return { org_id: target.orgId, kind: "input", target_device: target.device, folder: target.folder, payload: { cardId: target.cardId, ...input } };
}

// weft.zip's tap, swipe or Start, or null for one the worker wouldn't take.
export function plainInputCommand(target: CardTarget, input: unknown): NewCommand | null {
  const clean = plainScreenInput(input);
  return clean ? inputRow(target, clean) : null;
}
