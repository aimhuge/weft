"use client";

// Make a coupon code: a percent or an amount off, for one invoice, some months or forever, with optional limits.
// lib/billing/admin/coupons.ts readCoupon is the validation; this only gathers the fields.
// Built on the admin kit (components/admin): a titled section with a responsive grid of labelled fields.

import { useState } from "react";
import { Button, Checkbox, Field, Input, Section, Select } from "@/components/admin/kit";

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
    <Section title="New code" note="A percent or an amount off, for one invoice, some months or forever.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Code">
          <Input
            className="font-mono uppercase"
            placeholder="LAUNCH20"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label="Code"
          />
        </Field>
        <Field label="Amount">
          <Input type="number" min={1} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Amount" />
        </Field>
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as "percent" | "amount")} aria-label="Kind">
            <option value="percent">% off</option>
            <option value="amount">$ off</option>
          </Select>
        </Field>
        <Field label="Duration">
          <Select value={duration} onChange={(e) => setDuration(e.target.value)} aria-label="Duration">
            <option value="once">once</option>
            <option value="repeating">for months</option>
            <option value="forever">forever</option>
          </Select>
        </Field>
        {duration === "repeating" && (
          <Field label="Months">
            <Input type="number" min={1} value={months} onChange={(e) => setMonths(e.target.value)} aria-label="Months" />
          </Field>
        )}
        <Field label="Max uses">
          <Input type="number" min={1} placeholder="Max uses" value={max} onChange={(e) => setMax(e.target.value)} aria-label="Max uses" />
        </Field>
        <Field label="Expires">
          <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} aria-label="Expires" />
        </Field>
        <div className="flex items-end pb-1">
          <Checkbox label="first purchase only" checked={firstTime} onChange={setFirstTime} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" disabled={!code} onClick={() => void submit()}>
          Create
        </Button>
      </div>
    </Section>
  );
}
