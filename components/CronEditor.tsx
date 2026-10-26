"use client";

import { useState, type SubmitEvent } from "react";
import { DAY_LETTERS, PRESETS, readback, runLabel, timeValue, toggleDay, upcoming, withTime, type CronForm } from "@/lib/cron-form";
import CronCalendar from "./CronCalendar";

const LABEL = "mb-1 mt-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted";
const FIELD = "rounded-md border border-line-strong bg-panel px-2 py-1 text-[12px] text-ink outline-none focus:border-[var(--cron)]";

// The ⏰ popover's form (components/CronButton.tsx) and the Crons drawer's Edit: what to send, fork or fresh, how
// often, from which day, and until when. The parent turns the form into a request (lib/cron-form.ts inputOf).
export default function CronEditor({
  initial,
  now,
  prompt = true,
  canFork = false,
  submitLabel,
  footer,
  onSubmit,
}: {
  initial: CronForm;
  now: number;
  // The New thread window's prompt is the composer above it, so the form leaves its own out.
  prompt?: boolean;
  // Only a thread that has run can be forked; otherwise each run starts fresh and the choice isn't shown.
  canFork?: boolean;
  submitLabel: string;
  footer?: React.ReactNode;
  onSubmit: (form: CronForm) => Promise<void> | void;
}) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<CronForm>) => setForm((f) => ({ ...f, ...patch }));
  const pick = form.pick;
  const runs = upcoming(form, now, 40);

  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="text-[12.5px]">
      {prompt && (
        <>
          <p className={LABEL}>Send</p>
          <textarea value={form.prompt} onChange={(e) => set({ prompt: e.target.value })} rows={2} aria-label="What each run sends" className={`${FIELD} w-full resize-y`} />
        </>
      )}
      {canFork && (
        <>
          <p className={LABEL}>Each run</p>
          <div className="flex overflow-hidden rounded-md border border-line-strong" role="radiogroup" aria-label="Each run">
            {(["fork", "fresh"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={form.mode === m} onClick={() => set({ mode: m })} className={`flex-1 px-2 py-1 text-center ${form.mode === m ? "bg-cron-soft font-semibold text-cron" : "text-ink hover:bg-sunken"} ${m === "fork" ? "border-r border-line-strong" : ""}`}>
                {m === "fork" ? "Fork from here" : "Fresh thread"}
                <span className="block text-[10.5px] font-normal text-faint">{m === "fork" ? "new card, context + page" : "new card, prompt only"}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <p className={LABEL}>Repeat</p>
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" aria-pressed={pick.preset === p.id} onClick={() => set({ pick: { ...pick, preset: p.id, expr: p.id === "custom" ? pick.expr ?? "0 9 * * 1-5" : pick.expr } })} className={`rounded-full border px-2 py-0.5 text-[11.5px] ${pick.preset === p.id ? "border-[var(--cron)] bg-[var(--cron)] text-white" : "border-line-strong text-ink hover:bg-sunken"}`}>
            {p.label}
          </button>
        ))}
      </div>
      <p className={LABEL}>Starting</p>
      <div className="flex gap-2">
        <CronCalendar start={form.start} runs={runs} now={now} onPick={(day) => set({ start: day })} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {pick.preset === "custom" ? (
            <input value={pick.expr ?? ""} onChange={(e) => set({ pick: { ...pick, expr: e.target.value } })} aria-label="Cron" placeholder="0 9 * * 1-5" className={`${FIELD} font-mono`} />
          ) : (
            <label className="flex items-center justify-between gap-1 text-muted">
              {pick.preset === "hourly" ? "Minute" : "Time"}
              <input type="time" value={timeValue(pick)} onChange={(e) => set({ pick: withTime(pick, e.target.value) })} aria-label="Time" className={FIELD} />
            </label>
          )}
          {pick.preset === "weekly" && (
            <div className="flex gap-0.5" aria-label="Days">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button key={d} type="button" aria-pressed={pick.days.includes(d)} onClick={() => set({ pick: toggleDay(pick, d) })} className={`size-5 rounded-full border text-[10.5px] ${pick.days.includes(d) ? "border-[var(--cron)] bg-[var(--cron)] text-white" : "border-line-strong text-ink"}`}>
                  {DAY_LETTERS[d]}
                </button>
              ))}
            </div>
          )}
          {pick.preset === "monthly" && (
            <label className="flex items-center justify-between gap-1 text-muted">
              Day
              <input type="number" min={1} max={31} value={pick.dom} onChange={(e) => set({ pick: { ...pick, dom: Math.min(31, Math.max(1, Number(e.target.value) || 1)) } })} aria-label="Day of the month" className={`${FIELD} w-14`} />
            </label>
          )}
          <label className="flex items-center justify-between gap-1 text-muted">
            Ends
            <input type="date" value={form.end ? new Date(form.end).toLocaleDateString("en-CA") : ""} onChange={(e) => set({ end: e.target.value ? new Date(`${e.target.value}T00:00`).getTime() : undefined })} aria-label="Ends" className={`${FIELD} w-[118px]`} />
          </label>
        </div>
      </div>
      <p className="mt-2 rounded-md bg-sunken px-2 py-1.5 text-[11.5px] text-muted">
        <span className="text-ink">{readback(form)}</span>
        {runs.length > 0 && <> · next {runs.slice(0, 3).map((r) => runLabel(r, now)).join(", ")}</>}
      </p>
      {error && <p className="mt-1.5 text-[11.5px] text-danger">{error}</p>}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="min-w-0 text-[11px] text-faint">{footer ?? "Each run: a new card and its run page"}</span>
        <button type="submit" disabled={busy} className="shrink-0 rounded-md bg-[var(--cron)] px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
