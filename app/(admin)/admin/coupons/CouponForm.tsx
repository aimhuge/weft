"use client";

// Make a coupon code: a percent or an amount off, for one invoice, some months or forever, with optional limits.
// lib/billing/admin/coupons.ts readCoupon is the validation; this only gathers the fields.

import { useState } from "react";
import { ui } from "../billing/admin-api";

export default function CouponForm({ onCreate }: { onCreate: (input: Record<string, unknown>) => Promise<boolean> }) {
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("20");
  const [duration, setDuration] = useState("once");
  const [months, setMonths] = useState("3");
  const [max, setMax] = useState("");
  const [expires, setExpires] = useState("");
  const [firstTime, setFirstTime] = useState(false);

  const submit = async () => {
    const amount = Number(value);
    const ok = await onCreate({
      code,
      ...(kind === "percent" ? { percentOff: amount } : { amountOffCents: Math.round(amount * 100) }),
      duration,
      durationMonths: duration === "repeating" ? months : undefined,
      maxRedemptions: max,
      expiresAt: expires ? new Date(expires).toISOString() : "",
      firstTimeOnly: firstTime,
    });
    if (ok) setCode("");
  };

  return (
    <section className={ui.card}>
      <h2 className={ui.h}>New code</h2>
      <div className={ui.row}>
        <input className={`${ui.input} w-36 font-mono uppercase`} placeholder="LAUNCH20" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Code" />
        <input className={`${ui.input} w-20`} type="number" min={1} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Amount" />
        <select className={ui.input} value={kind} onChange={(e) => setKind(e.target.value as "percent" | "amount")} aria-label="Kind">
          <option value="percent">% off</option>
          <option value="amount">$ off</option>
        </select>
        <select className={ui.input} value={duration} onChange={(e) => setDuration(e.target.value)} aria-label="Duration">
          <option value="once">once</option>
          <option value="repeating">for months</option>
          <option value="forever">forever</option>
        </select>
        {duration === "repeating" && <input className={`${ui.input} w-16`} type="number" min={1} value={months} onChange={(e) => setMonths(e.target.value)} aria-label="Months" />}
      </div>
      <div className={ui.row}>
        <input className={`${ui.input} w-28`} type="number" min={1} placeholder="Max uses" value={max} onChange={(e) => setMax(e.target.value)} aria-label="Max uses" />
        <input className={ui.input} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} aria-label="Expires" />
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={firstTime} onChange={(e) => setFirstTime(e.target.checked)} /> first purchase only
        </label>
        <button type="button" className={ui.btn} disabled={!code} onClick={() => void submit()}>Create</button>
      </div>
    </section>
  );
}
