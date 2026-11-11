// The "@" picker's floating list (docs/architecture/sharing.md#mentions), and the Share dialog's People suggestions: one
// row per person, avatar, @login and what picking them means (lib/share-people.ts pickHint). Driven like the "/" list
// (components/SkillTypeahead.tsx): arrow keys move the highlight, Enter or Tab or a click picks.
import { useEffect, useRef } from "react";
import type { MentionPerson } from "@weft/client";
import { pickHint } from "@/lib/share-people";

export default function PeopleTypeahead({
  people,
  active,
  className,
  shared = false,
  onPick,
  onHover,
}: {
  people: MentionPerson[];
  active: number;
  // Where it floats: above a reply box, or under the dialog's field.
  className: string;
  shared?: boolean;
  onPick: (person: MentionPerson) => void;
  onHover: (i: number) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <div ref={list} role="listbox" aria-label="People" className={`absolute z-40 max-h-[260px] max-w-[360px] overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-lg ${className}`}>
      {people.map((p, i) => {
        const hint = pickHint(p, shared);
        return (
          <button
            key={p.login}
            type="button"
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(p)}
            className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left ${i === active ? "bg-sunken" : ""}`}
          >
            {p.avatarUrl ? (
              <img src={`${p.avatarUrl}${p.avatarUrl.includes("?") ? "&" : "?"}s=40`} alt="" width={20} height={20} loading="lazy" className="shrink-0 rounded-full bg-sunken" />
            ) : (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[10px] font-medium text-muted">{p.login[0]?.toUpperCase()}</span>
            )}
            <span className="min-w-0 flex-1 truncate text-[12.5px]">
              <span className="font-medium text-ink">{p.login}</span>
              {p.name && <span className="ml-1.5 text-muted">{p.name}</span>}
            </span>
            {p.kind === "github" && !shared ? null : (
              <span className={`shrink-0 truncate rounded px-1.5 py-px text-[10.5px] ${p.kind === "github" ? "text-muted" : "bg-sunken text-muted"}`}>{hint}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
