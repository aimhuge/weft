"use client";

import { useUiText } from "@/lib/ui-language";

// A Settings row: a title and hint on the left, an on/off switch on the right. The classes default
// to the Settings dialog's section title and hint.
export default function SwitchRow({
  title,
  hint,
  on,
  onChange,
  titleClass = "text-[13px] font-medium text-ink",
  hintClass = "text-[12.5px] text-muted",
}: {
  title: string;
  hint: string;
  on: boolean;
  onChange: (on: boolean) => void;
  titleClass?: string;
  hintClass?: string;
}) {
  const t = useUiText();
  return (
    <section className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h3 className={titleClass} data-settings-section={title}>{t(title)}</h3>
        <p className={hintClass}>{t(hint)}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={t(title)}
        onClick={() => onChange(!on)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-line-strong"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-panel shadow transition-[left] ${on ? "left-[18px]" : "left-0.5"}`} />
      </button>
    </section>
  );
}
