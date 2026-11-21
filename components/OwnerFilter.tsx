"use client";

// The project bar's person and machine pickers (lib/board-owners.ts), on the desktop board and weft.zip alike: whose
// cards to show (Everyone, You, a teammate) and which machine's (All machines, This Mac, a Mac or a Weft Worker). Each
// shows only when there's a choice to make, or one is already made, so a board of one person on one Mac stays as it was.
import { useUiText } from "@/lib/ui-language";
import type { OwnerChoices } from "@/lib/board-owners";
import type { RailFilter } from "@/lib/rail-view";

// Narrower on a phone, where the bar also holds the filter box and sort; the native picker opens full-size there anyway.
const SELECT = "max-w-[88px] sm:max-w-[128px] shrink-0 truncate rounded-md border bg-canvas px-2 py-1 text-[12px] outline-none focus:border-accent";
const on = (set: boolean) => (set ? "border-accent text-accent" : "border-line-strong text-ink");

export default function OwnerFilter({ choices, filter, onFilter, web }: { choices: OwnerChoices; filter: RailFilter; onFilter: (f: RailFilter) => void; web?: boolean }) {
  const t = useUiText();
  const style = web ? { colorScheme: "dark" as const } : undefined;
  const showPeople = choices.people.length > 1 || Boolean(filter.who);
  const showMachines = choices.machines.length > 1 || Boolean(filter.on);
  return (
    <>
      {showPeople && (
        <select
          value={filter.who ?? ""}
          // Another person's machines aren't this one's, so picking someone clears the machine.
          onChange={(e) => onFilter({ ...filter, who: e.target.value || undefined, on: undefined })}
          aria-label={t("Whose cards")}
          title={t("Whose cards")}
          style={style}
          className={`${SELECT} ${on(Boolean(filter.who))}`}
        >
          <option value="">{t("Everyone")}</option>
          {choices.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · {p.count}
            </option>
          ))}
          {filter.who && !choices.people.some((p) => p.id === filter.who) && <option value={filter.who}>{t("Nobody here")}</option>}
        </select>
      )}
      {showMachines && (
        <select
          value={filter.on ?? ""}
          onChange={(e) => onFilter({ ...filter, on: e.target.value || undefined })}
          aria-label={t("Which machine")}
          title={t("Which machine")}
          style={style}
          className={`${SELECT} ${on(Boolean(filter.on))}`}
        >
          <option value="">{t("All machines")}</option>
          {choices.machines.map((m) => (
            <option key={m.id} value={m.id}>
              {m.kind === "worker" ? "☁️" : "💻"} {m.label} · {m.count}
            </option>
          ))}
          {filter.on && !choices.machines.some((m) => m.id === filter.on) && <option value={filter.on}>{t("No cards there")}</option>}
        </select>
      )}
    </>
  );
}
