"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { track } from "@/lib/analytics";
import { planCards, type PlanCard } from "@/lib/billing/plan-cards";
import { UPGRADE_COPY, type CheckoutAnswer, type UpgradeInterval, type UpgradePlan, type UpgradeReason } from "@/lib/billing/upgrade";
import { api } from "@/lib/client";
import { useOverlay } from "@/lib/overlay";
import { loadBilling, useBillingStatus } from "@/lib/use-billing-status";
import { closeUpgrade, useUpgradeReason } from "@/lib/use-upgrade";
import Modal from "./Modal";
import Icon, { Spinner } from "./Icon";

// The upgrade dialog (docs/architecture/billing.md "The upgrade dialog"): Free, Pro and Team side by side with their
// prices, a monthly/yearly switch, and a button that starts Stripe Checkout. Mounted once per window (app/page.tsx on
// the desktop, the workspace layout on weft.zip) and opened from anywhere with openUpgrade(reason): a paywall such as
// inviting a teammate on Free, or the Upgrade button. The desktop opens Checkout in the system browser and picks the
// new plan up when the window regains focus; weft.zip goes to Checkout in the same tab.

export type Checkout = (plan: UpgradePlan, interval: UpgradeInterval) => Promise<CheckoutAnswer>;

const POLL_MS = 4000;

type Phase =
  | { kind: "pick" }
  | { kind: "busy"; plan: UpgradePlan }
  | { kind: "waiting"; plan: UpgradePlan }
  // The provider changed the plan inline (a paid workspace switching), so there's nothing to wait for.
  | { kind: "applied" }
  | { kind: "error"; error: string };

// Where Checkout opens: the system browser in the desktop app, a new tab for a board in a plain browser tab, and the
// same tab on weft.zip (which comes back to the billing page).
function openCheckout(url: string, sameTab: boolean) {
  if (window.weft) window.weft.openExternal(url);
  else if (sameTab) window.location.assign(url);
  else window.open(url, "_blank", "noopener");
}

export default function UpgradeDialog({ checkout }: { checkout?: Checkout }) {
  const reason = useUpgradeReason();
  if (!reason) return null;
  // Its own stacking layer, so it opens above a dialog that opened it (Share…, Settings).
  return createPortal(
    <div className="relative z-[70]">
      <UpgradePanel reason={reason} checkout={checkout} />
    </div>,
    document.body,
  );
}

function UpgradePanel({ reason, checkout }: { reason: UpgradeReason; checkout?: Checkout }) {
  const status = useBillingStatus();
  const [interval, setBilling] = useState<UpgradeInterval>("monthly");
  const [phase, setPhase] = useState<Phase>({ kind: "pick" });
  useOverlay(true);
  useEffect(() => track("upgrade_dialog_opened", { reason }), [reason]);

  const view = status && !("error" in status) ? status : null;
  const current = view?.plan.id ?? null;
  const done = phase.kind === "applied" || (phase.kind === "waiting" && (current === "pro" || current === "team"));
  const copy = UPGRADE_COPY[reason];

  // While Checkout is open, ask for the plan every few seconds as well as on focus: the webhook can land a moment
  // after you're back.
  const waiting = phase.kind === "waiting" && !done;
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void loadBilling(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting]);

  async function start(plan: UpgradePlan) {
    setPhase({ kind: "busy", plan });
    track("upgrade_checkout_started", { plan, interval, reason });
    const run: Checkout = checkout ?? ((p, i) => api.billingCheckout(p, i));
    const answer = await run(plan, interval).catch(
      (err: unknown): CheckoutAnswer => ({ ok: false, error: err instanceof Error ? err.message : "Couldn't start checkout." }),
    );
    if (!answer.ok) {
      setPhase({ kind: "error", error: answer.error });
    } else if ("url" in answer) {
      openCheckout(answer.url, Boolean(checkout));
      setPhase({ kind: "waiting", plan });
    } else {
      void loadBilling();
      setPhase({ kind: "applied" });
    }
  }

  return (
    <Modal title={done ? `You're on ${view?.plan.name ?? "your new plan"}` : copy.title} onClose={closeUpgrade} className="w-full max-w-[760px] max-h-[92vh]">
      <div className="overflow-y-auto px-5 py-4">
        {done ? (
          <Thanks reason={reason} />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] text-muted">{copy.sub}</p>
              <IntervalSwitch value={interval} onChange={setBilling} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {planCards(interval).map((card) => (
                <PlanColumn key={card.id} card={card} current={view?.plan ?? null} phase={phase} featured={card.id === "pro"} onPick={(plan) => void start(plan)} />
              ))}
            </div>
            <Footer phase={phase} manageUrl={view?.manageUrl ?? null} onBack={() => setPhase({ kind: "pick" })} />
          </>
        )}
      </div>
    </Modal>
  );
}

function IntervalSwitch({ value, onChange }: { value: UpgradeInterval; onChange: (v: UpgradeInterval) => void }) {
  const option = (v: UpgradeInterval, label: string) => (
    <button
      type="button"
      aria-pressed={value === v}
      onClick={() => onChange(v)}
      className={`rounded-full px-3 py-0.5 text-[12px] ${value === v ? "bg-ink text-panel" : "text-muted hover:text-ink"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex shrink-0 rounded-full border border-line p-0.5" role="group" aria-label="Billing interval">
      {option("monthly", "Monthly")}
      {option("yearly", "Yearly")}
    </div>
  );
}

function PlanColumn({
  card,
  current,
  phase,
  featured,
  onPick,
}: {
  card: PlanCard;
  current: { id: string; name: string } | null;
  phase: Phase;
  featured: boolean;
  onPick: (plan: UpgradePlan) => void;
}) {
  const chip = currentChip(card, current);
  const busy = phase.kind === "busy" && phase.plan === card.id;
  return (
    <section
      aria-label={card.name}
      className={`flex flex-col rounded-lg border p-3.5 ${featured ? "border-accent shadow-[0_0_0_1px_var(--color-accent)]" : "border-line"}`}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-ink">{card.name}</h3>
        {chip && <span className="rounded-full border border-line-strong px-2 text-[10.5px] text-muted">{chip}</span>}
      </div>
      <p className="mt-1.5 flex items-baseline gap-1">
        <span className="text-[24px] font-semibold leading-none text-ink">{card.price}</span>
        <span className="text-[11.5px] text-muted">{card.cadence}</span>
      </p>
      <p className="mt-1 h-4 text-[11.5px] text-accent">{card.note}</p>
      <ul className="mt-2 flex-1 space-y-1 text-[12px] text-ink">
        {card.features.map((f) => (
          <li key={f} className="flex gap-1.5">
            <Icon name="check" size={13} className="mt-[2px] shrink-0 text-muted" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      {card.id !== "free" && !chip && (
        <button
          type="button"
          onClick={() => onPick(card.id as UpgradePlan)}
          disabled={phase.kind === "busy"}
          className={`mt-3 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-60 ${
            featured ? "bg-accent text-on-accent hover:opacity-90" : "border border-line-strong text-ink hover:bg-sunken"
          }`}
        >
          {busy ? <Spinner size={12} /> : <Icon name="zap" size={13} />}
          Upgrade to {card.name}
        </button>
      )}
    </section>
  );
}

// The chip on the card of the plan you're on: "Current", or on the Free card for Open Source and Education, which
// sit on the free tier, their own name. Null on every other card.
function currentChip(card: PlanCard, current: { id: string; name: string } | null): string | null {
  if (!current) return null;
  if (current.id === card.id) return "Current";
  if (card.id !== "free" || current.id === "pro" || current.id === "team") return null;
  return current.name;
}

function Footer({ phase, manageUrl, onBack }: { phase: Phase; manageUrl: string | null; onBack: () => void }) {
  if (phase.kind === "error") {
    return (
      <p role="alert" className="mt-3 text-[12px] text-danger">
        {phase.error}
      </p>
    );
  }
  if (phase.kind === "waiting") {
    return (
      <p role="status" className="mt-3 flex items-center gap-1.5 text-[12px] text-muted">
        <Spinner size={11} /> Finish checkout on Stripe in your browser. Weft picks up your new plan when you come back.
        <button type="button" onClick={onBack} className="ml-1 underline hover:text-ink">
          Pick again
        </button>
      </p>
    );
  }
  return (
    <p className="mt-3 text-[11.5px] text-muted">
      Prices in USD, per workspace. Checkout is on Stripe; cancel any time.
      {manageUrl && (
        <>
          {" "}
          Open source or a student?{" "}
          <a href={manageUrl} target="_blank" rel="noopener" className="underline hover:text-ink">
            Free plans on weft.zip
          </a>
        </>
      )}
    </p>
  );
}

function Thanks({ reason }: { reason: UpgradeReason }) {
  return (
    <div className="py-6 text-center">
      <p className="text-[15px] font-medium text-ink">Thanks — your workspace is upgraded.</p>
      <p className="mt-1 text-[13px] text-muted">{reason === "teams" ? "Send that invite again; it'll go through now." : "Everything your plan includes is on now."}</p>
      <button type="button" onClick={closeUpgrade} className="mt-4 rounded-md bg-accent px-4 py-1.5 text-[12.5px] font-medium text-on-accent hover:opacity-90">
        Done
      </button>
    </div>
  );
}
