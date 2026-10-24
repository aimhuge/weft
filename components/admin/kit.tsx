// Weft's admin kit: the pieces every /admin page is built from, on the board's own tokens (canvas, panel, line, ink),
// so the admin pages match the board in light and dark. The table is next door in DataTable.tsx.

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";

const TONE_PILL: Record<Tone, string> = {
  neutral: "bg-sunken text-muted",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

// One admin page: a title row (with optional actions on the right) above its content, at a readable width.
export function AdminPage({ title, subtitle, actions, wide, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <main className={`mx-auto flex w-full flex-col gap-5 px-6 pb-10 pt-6 text-ink ${wide ? "max-w-7xl" : "max-w-5xl"}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="text-[13px] text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </main>
  );
}

// A card with a small caps title, an optional note under it and actions on its right. tone="danger" for destructive ones.
export function Section({ title, note, actions, tone, children }: { title?: string; note?: ReactNode; actions?: ReactNode; tone?: "danger"; children?: ReactNode }) {
  return (
    <section className={`flex flex-col gap-3 rounded-xl border bg-panel px-4 py-3.5 text-[13px] ${tone === "danger" ? "border-danger/30" : "border-line"}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            {title && <h2 className={`text-[11px] font-semibold uppercase tracking-wider ${tone === "danger" ? "text-danger" : "text-faint"}`}>{title}</h2>}
            {note && <p className="text-[12.5px] text-muted">{note}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>;
}

export function Stat({ label, value, hint, mono }: { label: string; value: ReactNode; hint?: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-line bg-panel px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">{label}</div>
      <div className={`break-words text-[20px] font-semibold leading-tight ${mono ? "font-mono text-[13px] font-normal" : ""}`}>{value}</div>
      {hint && <div className="text-[12px] text-muted">{hint}</div>}
    </div>
  );
}

export function Badge({ tone = "neutral", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_PILL[tone]}`}>
      {children}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger"; size?: "sm" | "md" };

const BUTTON: Record<NonNullable<ButtonProps["variant"]>, string> = {
  default: "border-line-strong bg-panel text-ink hover:bg-sunken",
  primary: "border-transparent bg-accent text-on-accent hover:opacity-90",
  danger: "border-danger/40 bg-panel text-danger hover:bg-danger-soft",
};

export function Button({ variant = "default", size = "md", className = "", type = "button", ...rest }: ButtonProps) {
  const pad = size === "sm" ? "px-2 py-0.5 text-[12px]" : "px-3 py-1.5 text-[13px]";
  return <button type={type} className={`inline-flex items-center gap-1.5 rounded-lg border font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${pad} ${BUTTON[variant]} ${className}`} {...rest} />;
}

const FIELD = "rounded-lg border border-line-strong bg-canvas px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none";

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD} ${className}`} {...rest} />;
}

export function Select({ className = "", ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${FIELD} ${className}`} {...rest} />;
}

// A labelled control: the label above, small; for forms like the coupon maker.
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[12px] text-muted">
      {label}
      {children}
    </label>
  );
}

export function Checkbox({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <input type="checkbox" className="accent-[var(--accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// A one-line message under a control: what an action did, or why it failed.
export function Notice({ tone, children }: { tone: "ok" | "danger" | "warn"; children: ReactNode }) {
  return <div className={`rounded-lg px-3 py-2 text-[13px] ${TONE_PILL[tone]}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-[13px] text-muted">{children}</div>;
}

// label: value rows, for ids and settings.
export function KeyValues({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words font-mono text-[12px]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
