// The live view's clicks and drags (lib/simulator-viewer.ts → electron/sim-live.cjs → /api/simulator/input): a
// point given as a fraction of the screen becomes a tap or swipe in the units that platform's taps take. Only a
// device being watched takes them, and only once its screen size is known.
import { bootedDevice } from "./simulator-devices";
import { swipe, tapAt } from "./simulator-ui";
import { markLive, watchedSize, watching } from "./simulator-watch";

export type LiveInput = { kind: "tap" | "swipe" | "live"; device: string; x?: number; y?: number; x2?: number; y2?: number; ms?: number };

const unit = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);

export function parseInput(raw: unknown): LiveInput {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = body.kind;
  if (kind !== "tap" && kind !== "swipe" && kind !== "live") throw new Error("Unknown input.");
  if (typeof body.device !== "string" || !body.device) throw new Error("Which device?");
  const num = (k: string) => {
    const v = body[k];
    return typeof v === "number" ? v : undefined;
  };
  return { kind, device: body.device, x: num("x"), y: num("y"), x2: num("x2"), y2: num("y2"), ms: num("ms") };
}

export async function sendInput(input: LiveInput): Promise<string> {
  const d = await bootedDevice(input.device);
  if (!watching(d.id)) throw new Error(`${d.name} isn't being watched; ask the thread to watch it again.`);
  if (input.kind === "live") {
    markLive(d.id);
    return "live";
  }
  const size = watchedSize(d.id);
  if (!size) throw new Error(`Couldn't read ${d.name}'s screen size, so taps here can't be placed.`);
  const at = (x?: number, y?: number) => ({ x: Math.round(unit(x) * size.width), y: Math.round(unit(y) * size.height) });
  const from = at(input.x, input.y);
  if (input.kind === "tap") {
    await tapAt(d, from.x, from.y);
    return `tap ${from.x},${from.y}`;
  }
  const to = at(input.x2, input.y2);
  await swipe(d, from, to, Math.min(1500, Math.max(100, input.ms ?? 300)));
  return `swipe ${from.x},${from.y} → ${to.x},${to.y}`;
}
