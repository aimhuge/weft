"use client";

import LimitBurndown from "./LimitBurndown";
import Tip from "./Tip";
import { cacheMinutesLeft, folderName, formatReset, formatTokens } from "@/lib/format";
import { shareLeft } from "@/lib/limit-chart";
import { liveWindow, PLAN_ORDER } from "@/lib/plan-limits";
import { BACKEND_LABELS, type Backend, type CacheState, type CardStats, type LimitWindow } from "@/lib/types";
import { usePlanLimits } from "@/lib/use-plan-limits";
import { useNow } from "@/lib/use-now";

// Green while plenty is left, then warn, then danger (same cut-offs as the terminal statusline).
function tone(left: number) {
  return left >= 60 ? "text-ok" : left >= 30 ? "text-warn" : "text-danger";
}

// Each CLI's own colour, so a card's model reads as the CLI it runs on. Claude has none of
// its own here and takes the warning tone; puku and the two plain CLIs (Codex, Goose) take
// the accent.
function modelTone(backend?: Backend) {
  if (backend === "puku") return "text-puku";
  if (backend === "codex" || backend === "goose") return "text-accent";
  return "text-warn";
}

const CLI_NAMES: Record<Backend, string> = { claude: "claude", puku: "puku", codex: "codex", goose: "goose" };

// Which CLI and model the thread runs on: the model its session started with (runsOn), else the one the
// last turn spent most on. The tip says when those differ (a subagent or side call cost more).
function ModelChip({ backend = "claude", stats }: { backend?: Backend; stats: CardStats }) {
  const model = stats.runsOn?.model ?? stats.model;
  const effort = stats.runsOn?.effort ? `, ${stats.runsOn.effort} effort` : "";
  const spent = stats.model && stats.runsOn && stats.model !== stats.runsOn.model
    ? ` The last turn spent most on ${stats.model} (a subagent or side call).`
    : "";
  return (
    <Tip text={`${BACKEND_LABELS[backend]}${model ? ` on ${model}` : ""}${effort}.${spent}`}>
      <span className={modelTone(backend)}>
        [{CLI_NAMES[backend]}{model && ` · ${model.replace(/^claude-/, "")}`}]
      </span>
    </Tip>
  );
}

// One plan window's share left and reset; the hover over both is the burndown chart (LimitBurndown).
function Limit({ label, window }: { label: string; window?: LimitWindow }) {
  if (!window) return null;
  const left = shareLeft(window.used);
  return (
    <span>
      {label}:<span className={tone(left)}>{left}%</span>
      {window.resetsAt && (
        <span className="text-faint">
          {" "}
          reset {formatReset(window.resetsAt)}
        </span>
      )}
    </span>
  );
}

// A CLI's plan: its 5-hour and weekly windows as of now (a passed reset reads full), named when the
// strip lists more than one plan. The hover is the week's chart.
function Plan({ backend, reading, named }: { backend: Backend; reading: Pick<CardStats, "fiveHour" | "sevenDay">; named: boolean }) {
  const now = useNow();
  const fiveHour = liveWindow(reading.fiveHour, now);
  const sevenDay = liveWindow(reading.sevenDay, now);
  if (!fiveHour && !sevenDay) return null;
  return (
    <Tip text={<LimitBurndown backend={backend} stats={reading} />} width={664} className="inline-flex gap-x-3">
      {named && <span className={modelTone(backend)}>{CLI_NAMES[backend]}</span>}
      <Limit label="5hr" window={fiveHour} />
      <Limit label="7d" window={sevenDay} />
    </Tip>
  );
}

// The plan limits: the open card's CLI's plan, or every CLI's when no card is open. The plan limits are
// one pool per account (lib/plan-pools.ts), so a card on any CLI of the plan reads the same windows;
// they come from the limits log (lib/use-plan-limits.ts), and where that isn't there (the web board), the
// card's own last reading stands in.
function Plans({ backend, stats }: { backend?: Backend; stats?: CardStats }) {
  const plans = usePlanLimits(limitKey(stats));
  const shown: [Backend, Pick<CardStats, "fiveHour" | "sevenDay"> | undefined][] = plans
    ? backend
      ? [[backend, plans[backend]]]
      : PLAN_ORDER.filter((b) => plans[b]).map((b) => [b, plans[b]])
    : stats
      ? [[backend ?? "claude", stats]]
      : [];
  return shown.map(([b, reading]) =>
    reading ? (
      <Plan key={b} backend={b} reading={reading} named={!backend && !stats} />
    ) : (
      <Tip key={b} text={`${BACKEND_LABELS[b]} hasn't reported its plan's 5-hour and weekly limits yet.`}>
        <span className="text-faint">no plan limits yet</span>
      </Tip>
    ),
  );
}

// A card's new reading reads the plans again, so its strip never lags its own thread.
function limitKey(stats?: CardStats) {
  const w = (x?: LimitWindow) => (x ? `${x.used}@${x.resetsAt ?? ""}` : "");
  return stats ? `${w(stats.fiveHour)}|${w(stats.sevenDay)}` : undefined;
}

// How long the prompt cache stays warm, or "cold" with what the next message sends again at full price.
function Cache({ cache }: { cache?: CacheState }) {
  const now = useNow();
  if (!cache || !now) return null;
  const minutes = cacheMinutesLeft(cache, now);
  const size = formatTokens(cache.tokens);
  const life = cache.ttl >= 3600 ? "an hour" : `${Math.round(cache.ttl / 60)} minutes`;
  if (!minutes) {
    return (
      <Tip text={`Prompt cache gone cold: it lasts ${life} after the last request. Your next message sends this thread's ${size} tokens again at full price instead of about a tenth, which takes a bigger bite of the 5-hour limit. For a new topic, a fresh card is cheaper.`}>
        cache:<span className="text-warn">cold {size}</span>
      </Tip>
    );
  }
  return (
    <Tip text={`Prompt cache warm for ${minutes} more min (it lasts ${life} after each request). The last request read ${cache.hit}% of its ${size} tokens from cache, at about a tenth of the price. Reply before it runs out to keep it cheap.`}>
      cache:<span className="text-ok">{minutes}m</span>
    </Tip>
  );
}

// Two parts. The thread's, only when a card is open (stats): folder, CLI and model, context left, cache,
// tokens. The plan's, always: the 5-hour and weekly limits of that card's CLI, or of every CLI when no card
// is open. The folder's uncommitted lines moved to the header (components/PileBadge.tsx).
export default function StatusStrip({
  stats,
  cwd,
  backend,
  className = "",
}: {
  // The open card's numbers; leave out when no card is open.
  stats?: CardStats;
  cwd?: string;
  // Which CLI the thread runs on (or the New thread dialog will start), whose plan the strip shows.
  backend?: Backend;
  className?: string;
}) {
  const left = stats?.contextUsed === undefined ? undefined : 100 - stats.contextUsed;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-0.5 font-mono text-[11px] text-muted ${className}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 whitespace-nowrap">
        {cwd && (
          <Tip text={stats?.branch ? `${cwd} on branch ${stats.branch}` : cwd}>
            <span className="text-ok">{folderName(cwd)}</span>
            {stats?.branch && <span className="text-accent"> ({stats.branch})</span>}
          </Tip>
        )}
        {stats && <ModelChip backend={backend} stats={stats} />}
        {stats && left !== undefined && (
          <Tip text={`Context window: ${left}% left (${stats.contextUsed}% filled by the last request). Near zero the thread is compacted or loses detail.`}>
            ctx:<span className={tone(left)}>{left}%</span>
          </Tip>
        )}
        <Cache cache={stats?.cache} />
        {stats?.tokens && (
          <Tip text={`${stats.tokens.toLocaleString()} input and output tokens used in this thread`}>
            tok:{formatTokens(stats.tokens)}
          </Tip>
        )}
        <Plans backend={backend} stats={stats} />
      </div>
    </div>
  );
}
