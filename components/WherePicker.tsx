"use client";

// The New thread dialog's folder picker where there is no local disk (weft.zip): your synced projects, grouped by the
// machine that runs them, your Macs first, then your Weft Workers (lib/new-card-transport.ts). The value is a place's
// key, which names the machine and the folder together. On a worker's place, Plan first sits beside it.
import { useUiText } from "@/lib/ui-language";
import { isWorkerDevice, placeKey, type NewCardTransport } from "@/lib/new-card-transport";
import type { WebTarget } from "@/lib/web-commands";
import Icon from "./Icon";

export default function WherePicker({ places, value, onChange, plan }: { places: WebTarget[]; value: string; onChange: (key: string) => void; plan?: NewCardTransport["plan"] }) {
  const t = useUiText();
  const macs = places.filter((p) => !isWorkerDevice(p.device));
  const workers = places.filter((p) => isWorkerDevice(p.device));
  const option = (p: WebTarget) => (
    <option key={placeKey(p)} value={placeKey(p)}>
      {p.label}
    </option>
  );
  const worker = isWorkerDevice(value.split("\n")[0] ?? "");
  return (
    <>
    <label
      className="relative flex max-w-64 items-center gap-1.5 rounded-md border border-line-strong py-1.5 pl-2 pr-1.5 text-[12px] text-ink"
      title={t("Where it runs: one of your synced projects, on the Mac or worker that syncs it")}
    >
      <span aria-hidden>{worker ? "☁️" : "💻"}</span>
      <span className="sr-only">{t("Where it runs")}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 cursor-pointer appearance-none truncate bg-transparent pr-4 font-medium outline-none">
        {macs.length > 0 && <optgroup label={t("Your Macs")}>{macs.map(option)}</optgroup>}
        {workers.length > 0 && <optgroup label={t("Your workers")}>{workers.map(option)}</optgroup>}
      </select>
      <Icon name="chevronDown" size={12} className="pointer-events-none absolute right-1.5" />
    </label>
    {worker && plan && (
      <label className="flex items-center gap-1.5 text-[12px] text-muted" title={t("Starts in plan mode: it reads and plans, and asks before it changes anything")}>
        <input type="checkbox" checked={plan.on} onChange={(e) => plan.set(e.target.checked)} />
        {t("Plan first")}
      </label>
    )}
    </>
  );
}
