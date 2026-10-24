"use client";

// The client half of /admin/coupons: one Stripe mode's Weft promotion codes (make one, turn one on or off) and every
// referral (pay its reward or void it). Referral codes are listed with the rest, marked "referral".
// Built on the admin kit (components/admin): an admin page, a mode switch, and two data tables.

import { useCallback, useEffect, useState } from "react";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { AdminPage, Badge, Button, Notice, Section, type Tone } from "@/components/admin/kit";
import { adminGet, adminPost, day, money } from "../admin-api";
import CouponForm from "./CouponForm";

interface Coupon {
  promotionId: string;
  code: string;
  active: boolean;
  percentOff: number | null;
  amountOffCents: number | null;
  duration: string;
  durationMonths: number | null;
  timesRedeemed: number;
  maxRedemptions: number | null;
  expiresAt: string | null;
  kind: string;
}

interface Referral {
  id: string;
  referrer: string;
  referred: string;
  code: string;
  mode: string;
  status: string;
  rewardCents: number;
  createdAt: string;
}

interface View {
  mode: string;
  keys: string[];
  coupons: Coupon[];
  referrals: Referral[];
  terms: { percentOff: number; months: number; rewardCents: number };
}

function off(c: Coupon): string {
  const amount = c.percentOff !== null ? `${c.percentOff}%` : money(c.amountOffCents);
  const span = c.duration === "repeating" ? `${c.durationMonths} months` : c.duration;
  return `${amount} off, ${span}`;
}

// A Stripe mode: live is the real one, test the sandbox.
function modeTone(mode: string): Tone {
  return mode === "live" ? "ok" : "warn";
}

// A referral's state: converted is waiting to be paid, rewarded is done, void never happened.
function statusTone(status: string): Tone {
  if (status === "converted") return "accent";
  if (status === "rewarded") return "ok";
  return "neutral";
}

export default function CouponsAdmin() {
  const [mode, setMode] = useState<string>("");
  const [view, setView] = useState<View | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    adminGet<View>(`/api/admin/coupons${mode ? `?mode=${mode}` : ""}`)
      .then((v) => {
        setView(v);
        setMode(v.mode);
      })
      .catch((e: unknown) => setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }));
  }, [mode]);
  useEffect(load, [load]);

  const run = async (payload: Record<string, unknown>) => {
    try {
      await adminPost("/api/admin/coupons", { mode, ...payload });
      setNote({ ok: true, text: `${String(payload.op)} done` });
      load();
      return true;
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };

  const couponColumns: Column<Coupon>[] = [
    { key: "code", header: "Code", cell: (c) => <span className="font-mono">{c.code}</span>, className: "whitespace-nowrap" },
    { key: "offer", header: "Offer", cell: (c) => <span className="text-muted">{off(c)}</span>, className: "whitespace-nowrap" },
    { key: "mode", header: "Mode", cell: () => <Badge tone={modeTone(mode)}>{mode || "—"}</Badge> },
    { key: "kind", header: "Kind", cell: (c) => <span className="text-muted">{c.kind}</span>, className: "whitespace-nowrap" },
    {
      key: "active",
      header: "Active",
      cell: (c) => <Badge tone={c.active ? "ok" : "neutral"}>{c.active ? "active" : "off"}</Badge>,
      className: "whitespace-nowrap",
    },
    {
      key: "uses",
      header: "Uses",
      cell: (c) => (
        <span className="text-muted">
          {c.timesRedeemed}
          {c.maxRedemptions ? `/${c.maxRedemptions}` : ""} used
        </span>
      ),
      className: "whitespace-nowrap",
    },
    {
      key: "expiry",
      header: "Expiry",
      cell: (c) => <span className="text-muted">{c.expiresAt ? `until ${day(c.expiresAt)}` : "—"}</span>,
      className: "whitespace-nowrap",
    },
    {
      key: "toggle",
      header: "",
      cell: (c) => (
        <Button
          size="sm"
          onClick={() => void run({ op: "set_active", id: c.promotionId, active: !c.active })}
        >
          {c.active ? "Turn off" : "Turn on"}
        </Button>
      ),
      className: "whitespace-nowrap",
    },
  ];

  const referralColumns: Column<Referral>[] = [
    {
      key: "referrer",
      header: "Referrer",
      cell: (r) => <span className="font-medium">{r.referrer}</span>,
      className: "whitespace-nowrap",
    },
    {
      key: "referred",
      header: "Referred",
      cell: (r) => <span className="text-muted">{r.referred}</span>,
      className: "whitespace-nowrap",
    },
    { key: "mode", header: "Mode", cell: (r) => <Badge tone={modeTone(r.mode)}>{r.mode}</Badge> },
    { key: "status", header: "Status", cell: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    {
      key: "reward",
      header: "Reward",
      cell: (r) => <span className="text-muted">{r.rewardCents ? money(r.rewardCents) : "—"}</span>,
      className: "whitespace-nowrap",
    },
    {
      key: "date",
      header: "Date",
      cell: (r) => <span className="text-muted">{day(r.createdAt)}</span>,
      className: "whitespace-nowrap",
    },
    {
      key: "actions",
      header: "",
      cell: (r) =>
        r.status === "converted" ? (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void run({ op: "pay_reward", id: r.id })}>
              Pay
            </Button>
            <Button size="sm" variant="danger" onClick={() => void run({ op: "void_referral", id: r.id })}>
              Void
            </Button>
          </div>
        ) : null,
      className: "whitespace-nowrap",
    },
  ];

  const modeButtons = (view?.keys ?? []).map((k) => (
    <Button key={k} size="sm" variant={k === mode ? "primary" : "default"} onClick={() => setMode(k)}>
      {k}
    </Button>
  ));

  return (
    <AdminPage
      title="Coupons"
      wide
      subtitle="Make a Stripe promotion code for a workspace, and pay or void referral rewards."
      actions={modeButtons}
    >
      {note && <Notice tone={note.ok ? "ok" : "danger"}>{note.text}</Notice>}

      <CouponForm onCreate={(input) => run({ op: "create", ...input })} />

      <Section title={`Codes in ${mode || "…"} mode`}>
        <DataTable
          columns={couponColumns}
          rows={view?.coupons ?? []}
          rowKey={(c) => c.promotionId}
          empty="No codes in this mode yet."
        />
      </Section>

      <Section
        title="Referrals"
        note={
          view
            ? `The referred workspace gets ${view.terms.percentOff}% off ${view.terms.months} months; the referrer gets ${money(view.terms.rewardCents)} on its Stripe balance.`
            : undefined
        }
      >
        <DataTable
          columns={referralColumns}
          rows={view?.referrals ?? []}
          rowKey={(r) => r.id}
          empty="No referrals yet."
        />
      </Section>
    </AdminPage>
  );
}
