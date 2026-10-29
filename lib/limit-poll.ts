import { globalSingleton } from "./global-singleton";
import { defaultBackend, listProjects } from "./settings";
import { recordLimits, setOnLimitReset } from "./limit-history";
import { releaseUpgradedModels } from "./limit-upgrade";
import { resumeParkedCards, resumeParkedOnModels } from "./limit-resume";
import { ensureSpare, open } from "./runner-session";
import { close, spares, type Session } from "./runner-state";
import { usageWindow } from "./turn";
import type { Backend } from "./types";

// The limits chart (components/LimitBurndown.tsx) only gets a new sample when a Weft thread turns on
// its CLI (lib/runner-turn.ts:300). Between turns, the chart sees gaps that look like "no log yet" cells.
// This poller asks the CLI for its 5-hour and weekly windows every LIMITS_POLL_MS, recording the same
// shape `recordLimits` already takes. The CLI's `usage_EXPERIMENTAL_*` is a local in-process read of
// the CLI's bookkeeping (no network, no tokens); the cost is one process startup on the first poll if
// no spare is open yet, and zero once one is. Codex has no equivalent yet, so the chart still shows
// its "no log yet" stretches there.

export const LIMITS_POLL_MS = 15 * 60_000;

// When the poll's first recordLimits sees a window drop from 100% to <100%, lib/limit-resume.ts
// re-sends the last user message of every parked card on that backend. We register the hook on
// first import so the very first poll that observes a reset fires the auto-resume.
let resumeInstalled = false;
function installAutoResume() {
  if (resumeInstalled) return;
  resumeInstalled = true;
  setOnLimitReset((sample) => {
    try {
      resumeParkedCards(sample.backend, sample.kind, Date.now());
    } catch (err) {
      console.warn("auto-resume of parked cards failed", err);
    }
  });
}

interface State {
  timer: ReturnType<typeof setInterval> | null;
  inFlight: Promise<void> | null;
  warned: boolean;
}

const state = () => globalSingleton<State>("__weftLimitPoll", () => ({ timer: null, inFlight: null, warned: false }));

// The folder to ask a CLI in: the most recently used project, falling back to the home dir if there
// is none. The folder is needed only to seed a spare's working directory; the usage call itself does
// not read the folder.
function pollCwd(): string | undefined {
  const project = listProjects()[0]?.path;
  if (project) return project;
  return process.env.HOME || process.env.USERPROFILE;
}

function pollBackend(): Backend {
  return defaultBackend();
}

// Reuse a spare if one is open for the right backend and folder; otherwise open a one-off session
// just long enough to ask, then close it. Closes the spare the poller opened itself; never touches
// spares the user has open for a card.
async function withSession<T>(backend: Backend, cwd: string, ask: (session: Session, query: NonNullable<Session["query"]>) => Promise<T>): Promise<T | undefined> {
  const key = `${backend}|${cwd}`;
  let session: Session | undefined = spares.get(key);
  let owns = false;
  if (!session || session.abort.signal.aborted || session.ended) {
    try {
      session = open({ cwd, backend, permissionMode: "default", copilot: false }, null);
      spares.set(key, session);
      owns = true;
    } catch {
      return undefined;
    }
  }
  const owned: Session = session;
  try {
    const query = session.query;
    if (!query) {
      // `query` is set during drive(), which runs as part of open(). It can be missing for a tick on
      // a brand-new spare before its first message; bail and let the next tick try again.
      return undefined;
    }
    return await ask(session, query);
  } finally {
    if (owns) {
      spares.delete(key);
      try {
        close(owned);
      } catch {}
    }
  }
}

async function pollOnce(now = Date.now()): Promise<void> {
  const backend = pollBackend();
  if (backend === "codex") return;
  const cwd = pollCwd();
  if (!cwd) return;
  const s = state();
  if (s.inFlight) return s.inFlight;
  s.inFlight = (async () => {
    try {
      // Touch the spare cache so the next new card has a warm start; the chart's sample is a side effect.
      ensureSpare(cwd, backend);
      const result = await withSession(backend, cwd, async (_session, query) => {
        const usage = await query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
        const limits = usage.rate_limits;
        if (!limits) return undefined;
        return { limits, fiveHour: usageWindow(limits.five_hour), sevenDay: usageWindow(limits.seven_day) };
      });
      if (!result) return;
      recordLimits(backend, { ...(result.fiveHour && { fiveHour: result.fiveHour }), ...(result.sevenDay && { sevenDay: result.sevenDay }) }, now);
      // An upgrade gives the account more room, and the per-model caps Weft is holding are stale:
      // the models behind them can run again. Free them, and wake the cards parked on them.
      // (The plan's own window reset is handled by the onReset hook above; this is the plan CHANGING.)
      const released = releaseUpgradedModels(result.limits, now);
      if (released.length) resumeParkedOnModels(released, now);
    } catch (err) {
      if (!s.warned) {
        s.warned = true;
        console.warn("limit poll failed; further errors are silent", err);
      }
    } finally {
      s.inFlight = null;
    }
  })();
  return s.inFlight;
}

// Starts the 15-minute poll. Idempotent and safe to call on every request: only one timer is set per
// process. The first sample runs at once so the chart isn't empty on a fresh boot; subsequent samples
// run on the interval. We never call clearInterval — the process is the lifetime; restarting Weft
// restarts the timer with the rest of the app.
export function startLimitPoll(): void {
  installAutoResume();
  const s = state();
  if (s.timer) return;
  void pollOnce();
  s.timer = setInterval(() => void pollOnce(), LIMITS_POLL_MS);
  // The Node default keeps the process alive for this timer; the Next server already needs that,
  // and a Weft-as-app shutdown kills the process outright. Unref for the dev case where the timer
  // would otherwise outlive the last open request.
  if (typeof (s.timer as { unref?: () => void }).unref === "function") (s.timer as { unref: () => void }).unref();
}

// Install the auto-resume hook on module load so the very first poll that observes a reset
// fires it even before startLimitPoll is called.
installAutoResume();
