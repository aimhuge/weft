"use client";

// The client half of /admin/coupons: one Stripe mode's Weft promotion codes (make one, turn one on or off) and every
// referral (pay its reward or void it). Referral codes are listed with the rest, marked "referral".

import { useCallback, useEffect, useState } from "react";
import { adminGet, adminPost, day, money, ui } from "../billing/admin-api";
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

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6 text-admin-text">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Coupons and referrals</h1>
        {view?.keys.map((k) => (
          <button key={k} type="button" className={`${ui.btn} ${k === mode ? "bg-black/5" : ""}`} onClick={() => setMode(k)}>
            {k}
          </button>
        ))}
      </div>
      {note && <p className={`text-sm ${note.ok ? "text-green-700" : "text-red-600"}`}>{note.text}</p>}
      <CouponForm onCreate={(input) => run({ op: "create", ...input })} />
      <section className={ui.card}>
        <h2 className={ui.h}>Codes in {mode || "…"} mode</h2>
        <table className="w-full text-left text-xs">
          <tbody>
            {view?.coupons.map((c) => (
              <tr key={c.promotionId} className={`border-t border-admin-border ${c.active ? "" : "opacity-50"}`}>
                <td className="py-1.5 pr-2 font-mono">{c.code}</td>
                <td className="pr-2">{off(c)}</td>
                <td className="pr-2 text-admin-muted">{c.kind}</td>
                <td className="pr-2">{c.timesRedeemed}{c.maxRedemptions ? `/${c.maxRedemptions}` : ""} used</td>
                <td className="pr-2 text-admin-muted">{c.expiresAt ? `until ${day(c.expiresAt)}` : ""}</td>
                <td>
                  <button type="button" className={ui.btn} onClick={() => void run({ op: "set_active", id: c.promotionId, active: !c.active })}>
                    {c.active ? "Turn off" : "Turn on"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className={ui.card}>
        <h2 className={ui.h}>Referrals</h2>
        {view && (
          <p className="text-xs text-admin-muted">
            The referred workspace gets {view.terms.percentOff}% off {view.terms.months} months; the referrer gets {money(view.terms.rewardCents)} on its Stripe balance.
          </p>
        )}
        <table className="w-full text-left text-xs">
          <tbody>
            {view?.referrals.map((r) => (
              <tr key={r.id} className="border-t border-admin-border">
                <td className="py-1.5 pr-2">{day(r.createdAt)}</td>
                <td className="pr-2">{r.referrer} → {r.referred}</td>
                <td className="pr-2 font-mono">{r.code}</td>
                <td className="pr-2">{r.mode} · {r.status}{r.rewardCents ? ` · ${money(r.rewardCents)}` : ""}</td>
                <td className={ui.row}>
                  {r.status === "converted" && (
                    <>
                      <button type="button" className={ui.btn} onClick={() => void run({ op: "pay_reward", id: r.id })}>Pay reward</button>
                      <button type="button" className={ui.btn} onClick={() => void run({ op: "void_referral", id: r.id })}>Void</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {view?.referrals.length === 0 && <p className="text-xs text-admin-muted">No referrals yet.</p>}
      </section>
    </div>
  );
}
