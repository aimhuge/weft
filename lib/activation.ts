// The desktop funnel past onboarding (docs/architecture/analytics.md): the first card started, the first card moved to
// Done, and one ping per day Weft is used, so retention shows for Macs that never make an account. Each goes out once
// (once a day for the ping) through the same anonymous, switchable path as the onboarding stats (lib/telemetry-send.ts).
// What was sent is kept in ~/.weft/activation.json, so a restart doesn't send it again.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store";
import { forwardOnboarding } from "./telemetry-send";

export const ACTIVATION_FILE = path.join(DATA_DIR, "activation.json");

type Sent = { firstCard?: number; firstDone?: number; lastDay?: string };

function readSent(file: string): Sent {
  try {
    return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as Sent;
  } catch {
    return {};
  }
}

function writeSent(file: string, sent: Sent) {
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  fs.writeFileSync(/*turbopackIgnore: true*/ file, JSON.stringify(sent, null, 2));
}

const localDay = (now: number) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type Opts = { file?: string; now?: number; send?: typeof forwardOnboarding };

// Marks the step before sending, so two quick calls can't both send it; a send that fails is not retried.
export async function trackActivation(step: "card" | "done" | "day", props: Record<string, unknown> = {}, opts: Opts = {}): Promise<boolean> {
  const { file = ACTIVATION_FILE, now = Date.now(), send = forwardOnboarding } = opts;
  const sent = readSent(file);
  if (step === "card") {
    if (sent.firstCard !== undefined) return false;
    writeSent(file, { ...sent, firstCard: now });
    return send("activation_first_card", props);
  }
  if (step === "done") {
    if (sent.firstDone !== undefined) return false;
    writeSent(file, { ...sent, firstDone: now });
    const minutes = sent.firstCard !== undefined ? Math.round((now - sent.firstCard) / 60000) : -1;
    return send("activation_first_done", { minutes_since_first_card: minutes });
  }
  const day = localDay(now);
  if (sent.lastDay === day) return false;
  writeSent(file, { ...sent, lastDay: day });
  return send("desktop_active_day", { has_done: sent.firstDone !== undefined });
}
