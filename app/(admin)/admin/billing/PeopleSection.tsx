"use client";

// A workspace's people in its admin panel: add someone with a Weft account, remove someone (never the last owner), and
// on Team keep the Stripe seat count in step with the roster.

import { useState } from "react";
import { ui } from "./admin-api";
import type { OrgDetail, RunOp } from "./org-types";

export default function PeopleSection({ detail, run }: { detail: OrgDetail; run: RunOp }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const team = detail.row?.plan === "team";
  return (
    <section className={ui.card}>
      <h2 className={ui.h}>
        People · {detail.members.length}
        {team ? ` · ${detail.row?.seats ?? 1} seats billed` : ""}
      </h2>
      <ul className="flex flex-col gap-1 text-xs">
        {detail.members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-2">
            <span className="truncate">
              {m.email ?? m.userId} <span className="text-admin-muted">{m.role}</span>
            </span>
            <button type="button" className={ui.btn} onClick={() => void run("member_remove", { userId: m.userId }, `Remove ${m.email ?? "them"}?`)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className={ui.row}>
        <input className={`${ui.input} w-56`} placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className={ui.input} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="member">member</option>
          <option value="admin">admin</option>
          <option value="owner">owner</option>
        </select>
        <button type="button" className={ui.btn} disabled={!email} onClick={() => void run("member_add", { email, role }).then(() => setEmail(""))}>Add</button>
        {team && <button type="button" className={ui.btn} onClick={() => void run("sync_seats")}>Sync seats</button>}
      </div>
    </section>
  );
}
