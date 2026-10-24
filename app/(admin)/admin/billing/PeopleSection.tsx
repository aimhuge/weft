"use client";

// A workspace's people in its admin panel: add someone with a Weft account, remove someone (never the last owner), and
// on Team keep the Stripe seat count in step with the roster.

import { useState } from "react";
import { Button, Field, Input, Section, Select } from "@/components/admin/kit";
import type { OrgDetail, RunOp } from "./org-types";

export default function PeopleSection({ detail, run }: { detail: OrgDetail; run: RunOp }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const team = detail.row?.plan === "team";
  const note = `People · ${detail.members.length}${team ? ` · ${detail.row?.seats ?? 1} seats billed` : ""}`;
  return (
    <Section title="People" note={note}>
      <ul className="flex flex-col gap-1 text-[13px]">
        {detail.members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-2">
            <span className="truncate">
              {m.email ?? m.userId} <span className="text-muted">{m.role}</span>
            </span>
            <Button size="sm" onClick={() => void run("member_remove", { userId: m.userId }, `Remove ${m.email ?? "them"}?`)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Email">
          <Input
            className="w-56"
            placeholder="email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="member">member</option>
            <option value="admin">admin</option>
            <option value="owner">owner</option>
          </Select>
        </Field>
        <Button variant="primary" disabled={!email} onClick={() => void run("member_add", { email, role }).then(() => setEmail(""))}>
          Add
        </Button>
        {team && <Button onClick={() => void run("sync_seats")}>Sync seats</Button>}
      </div>
    </Section>
  );
}
