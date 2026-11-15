"use client";

// Simple mode's one-box New thread dialog, laid out like the phone's new-card screen (~/dev/weft-mobile NewCard.tsx):
// project chips at the top when it wasn't opened on a project, calm room in the middle, and just over the composer
// the two pills showing the current choice, where it runs and the model, with a small More that brings back every
// control. NewCardDialog.tsx puts the composer under this; the picks are lib/one-box.ts.
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { useUiText } from "@/lib/ui-language";
import { FILTER_FROM, filterChips, oneBoxWhere, projectChips, showWherePill, type ProjectChip } from "@/lib/one-box";
import type { NewCardTransport } from "@/lib/new-card-transport";
import WherePicker from "./WherePicker";

// The header's "in <project>", dimmed after "New thread", as the phone's "New card  in <project>".
export function OneBoxTitle({ shown, cwd, places }: { shown: boolean; cwd: string; places?: NewCardTransport["places"] }) {
  const t = useUiText();
  if (!shown || !cwd) return null;
  return <span className="truncate font-normal text-faint">{t("in")} {oneBoxWhere(cwd, places)}</span>;
}

export function NewCardOneBox({ shown, chips, cwd, onPick, host, model, onMore }: {
  // Off (null) in the full layout: after More, or with the piece off.
  shown: boolean;
  // Offer project chips (lib/one-box.ts wantsProjectChips).
  chips: boolean;
  cwd: string;
  onPick: (folder: string) => void;
  // Its places, for the where pill (components/WherePicker.tsx), which shows only when there's a choice of place.
  host: Pick<NewCardTransport, "places" | "plan">;
  // The model pill.
  model: ReactNode;
  onMore: () => void;
}) {
  const t = useUiText();
  if (!shown) return null;
  const places = showWherePill(host.places) ? host.places : undefined;
  return (
    <>
      {chips && <ProjectChips value={cwd} onPick={onPick} />}
      {/* The calm room between the project and the words, so the composer sits at the bottom as on the phone. */}
      <div className="min-h-4 flex-1" />
      <div data-human-only className="flex shrink-0 flex-wrap items-center gap-2 pb-2.5">
        {places && (
          <div className="flex items-center gap-2 [&>label:first-child]:rounded-full">
            <WherePicker places={places} value={cwd} onChange={onPick} plan={host.plan} />
          </div>
        )}
        {model}
        <button type="button" onClick={onMore} className="ml-auto text-[12px] text-faint hover:text-ink hover:underline">
          {t("More")}
        </button>
      </div>
    </>
  );
}

// The projects you can start it in: the same list the folder picker loads (components/RepoPicker.tsx), recent first.
function ProjectChips({ value, onPick }: { value: string; onPick: (folder: string) => void }) {
  const t = useUiText();
  const [chips, setChips] = useState<ProjectChip[] | null>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    api
      .repos()
      .then((r) => setChips(projectChips(r.repos)))
      .catch(() => setChips([]));
  }, []);
  if (!chips?.length) return null;
  const shown = filterChips(chips, filter);
  return (
    <div data-human-only className="min-h-0 shrink overflow-y-auto">
      <p className="mb-2 text-[12px] font-medium text-muted">{t("Project")}</p>
      {chips.length > FILTER_FROM && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("Filter projects")}
          aria-label={t("Filter projects")}
          className="mb-2 w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-faint"
        />
      )}
      {shown.length ? (
        <div className="flex flex-wrap gap-1.5">
          {shown.map((c) => (
            <button
              key={c.path}
              type="button"
              title={c.path}
              aria-pressed={c.path === value}
              onClick={() => onPick(c.path)}
              className={`rounded-full border px-3 py-1 text-[12.5px] font-medium ${c.path === value ? "border-accent bg-accent text-on-accent" : "border-line-strong text-ink hover:bg-sunken"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-faint">{t("No projects match")} “{filter.trim()}”.</p>
      )}
    </div>
  );
}
