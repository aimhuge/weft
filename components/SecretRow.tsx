"use client";

import { Fragment } from "react";
import { isMac } from "@/lib/hotkeys";
import { hintParts, linkLabel } from "@/lib/hint-links";
import { openInPane } from "@/lib/open-in-pane";
import { useCountdown } from "@/lib/use-countdown";
import { useModHeld } from "@/lib/use-mod-held";
import { blankTitle, masked, type VaultSecret } from "@/lib/vault-view";
import type { RowAction } from "@/lib/vault-row-types";
import CountdownButton, { CONFIRM_WAIT_MS } from "./CountdownButton";
import Icon from "./Icon";
import { Tag } from "./VaultParts";

// A row in the 🔐 drawer (components/VaultDrawer.tsx).

export type { RowAction };

// One secret: its name and masked tail, with change, reveal, copy and remove on hover and its value once
// revealed. 🗑 turns into the countdown's red button (components/CountdownButton.tsx); leaving the row
// calls it off. When the name is in other environments too (spread), 🗑 asks which to remove it from.
export function SecretRow({
  secret: s,
  value,
  spread,
  onAct,
  onMenu,
}: {
  secret: VaultSecret;
  value: string | undefined;
  spread: boolean;
  onAct: (action: RowAction) => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const { left, arm, disarm } = useCountdown(CONFIRM_WAIT_MS);
  return (
    <div onContextMenu={onMenu} onMouseLeave={disarm} className="group rounded px-1.5 py-1 hover:bg-sunken">
      <div className="flex items-start gap-1.5 text-[11.5px]">
        <span className="min-w-0 flex-1 font-mono text-ink [overflow-wrap:anywhere]" title={s.missing ? blankTitle(s) : s.source ? `${s.name} · from ${s.source}` : s.name}>
          <WrapName name={s.name} />
        </span>
        {s.missing ? <Tag tone="warn">blank</Tag> : <span className="font-mono text-[10.5px] text-faint group-hover:hidden">{masked(s)}</span>}
        {left !== null ? (
          <CountdownButton
            left={left}
            label="Remove"
            ariaLabel={`Confirm removing ${s.name}`}
            title={`Remove ${s.name} (${s.environment}) from the vault`}
            onConfirm={() => {
              disarm();
              onAct("remove");
            }}
            className="px-1.5 text-[10.5px]"
          />
        ) : (
          <span className="flex gap-0.5">
            {s.missing ? (
              <button
                onClick={() => onAct("edit")}
                aria-label={`Fill in ${s.name}`}
                title={`Fill in ${s.name}${s.hint ? `: ${s.hint}` : ""}`}
                className="rounded bg-warn/15 px-1.5 py-0.5 text-[10.5px] font-medium text-warn hover:bg-warn/25"
              >
                Fill in
              </button>
            ) : (
              <span className="hidden gap-0.5 group-hover:flex">
                <HoverButton
                  icon="pencil"
                  label={`Change ${s.name}`}
                  title="Change its value or environments"
                  onClick={() => onAct("edit")}
                />
                <HoverButton
                  icon="eye"
                  label={value ? `Hide ${s.name}` : `Reveal ${s.name}`}
                  title={value ? "Hide" : "Reveal (Touch ID)"}
                  onClick={() => onAct("reveal")}
                />
                <HoverButton
                  icon="copy"
                  label={`Copy ${s.name}`}
                  title="Copy (Touch ID); clears from the clipboard after a minute"
                  onClick={() => onAct("copy")}
                />
              </span>
            )}
            {spread ? (
              <TrashButton name={s.name} title="Remove from one or more of its environments…" onArm={() => onAct("choose-remove")} />
            ) : (
              <TrashButton name={s.name} onArm={arm} onRemove={() => onAct("remove")} />
            )}
          </span>
        )}
      </div>
      {s.missing && s.hint && <HintText hint={s.hint} />}
      {/* data-secret: the board view (electron/board-view.cjs) reads this as ‹secret› and blanks it in screenshots. */}
      {value !== undefined && (
        <div data-secret className="mt-0.5 select-text break-all font-mono text-[10.5px] text-ink">
          {value}
        </div>
      )}
    </div>
  );
}

// A long name wraps after an underscore (STRIPE_WEBHOOK_ / SECRET), not mid-word; <wbr> adds nothing to a copy.
function WrapName({ name }: { name: string }) {
  // Fragments, not spans: the row's own text stays the whole name, for search and tests.
  return name.split("_").map((part, i, all) => (
    <Fragment key={i}>
      {part}
      {i < all.length - 1 && "_"}
      {i < all.length - 1 && <wbr />}
    </Fragment>
  ));
}

// A blank's hint in full, wrapped and never cut off; its links open in the browser pane, where you're signed in.
// onOpen runs first, for a dialog that has to close so the pane shows (components/IntakeDialog.tsx).
export function HintText({ hint, onOpen }: { hint: string; onOpen?: () => void }) {
  return (
    <p className="mt-0.5 break-words text-[10.5px] leading-snug text-faint">
      {hintParts(hint).map((p, i) =>
        "url" in p ? (
          <a
            key={i}
            href={p.url}
            title={`Open ${p.url} in the browser pane`}
            onClick={(e) => {
              e.preventDefault();
              onOpen?.();
              openInPane(p.url);
            }}
            className="break-all text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            {linkLabel(p.url)}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

// Reveal and copy carry data-secret-action, which the board view won't click (electron/board-view.cjs).
function HoverButton({ icon, label, title, onClick }: { icon: "pencil" | "eye" | "copy"; label: string; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={title}
      data-secret-action={icon === "pencil" ? undefined : icon}
      className="rounded p-0.5 text-muted hover:text-ink"
    >
      <Icon name={icon} size={12} />
    </button>
  );
}

// 🗑 starts the countdown; with ⌘ (Ctrl off macOS) held it turns red, and a click removes at once. Without
// onRemove, a held click arms too (the dialog it opens has its own countdown).
function TrashButton({ name, title, onArm, onRemove = onArm }: { name: string; title?: string; onArm: () => void; onRemove?: () => void }) {
  const hot = useModHeld();
  const mod = isMac() ? "⌘" : "Ctrl";
  return (
    <button
      onClick={(e) => (e.metaKey || e.ctrlKey ? onRemove() : onArm())}
      aria-label={`Remove ${name}`}
      title={title ?? (hot ? "Remove now" : `Remove from the vault (${mod}-click removes at once)`)}
      className={`rounded p-0.5 ${hot ? "text-danger" : "text-muted hover:text-ink"}`}
    >
      <Icon name="trash" size={12} />
    </button>
  );
}
