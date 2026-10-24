"use client";

import { useSyncExternalStore } from "react";
import { upgradeReasonOf, type UpgradeReason } from "./billing/upgrade";

// Which upgrade dialog is open, if any (components/UpgradeDialog.tsx, docs/architecture/billing.md "The upgrade
// dialog"). One for the whole window: a paywall anywhere (an invite form, the share dialog, a card's Puku error, the
// avatar menu's Upgrade button) calls openUpgrade, and the one mounted dialog shows it.

let reason: UpgradeReason | null = null;
const listeners = new Set<() => void>();

function set(next: UpgradeReason | null) {
  reason = next;
  for (const l of listeners) l();
}

export function openUpgrade(why: UpgradeReason = "plan"): void {
  set(why);
}

export function closeUpgrade(): void {
  set(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUpgradeReason(): UpgradeReason | null {
  return useSyncExternalStore(subscribe, () => reason, () => null);
}

// Opens the dialog when a team action came back refused by a paywall, and hands the result on unchanged, so a call
// site reads `actions.invite(email, role).then(upgradeOnGate)`.
export function upgradeOnGate<R extends { ok: boolean; message?: string; upgrade?: UpgradeReason }>(result: R): R {
  const why = upgradeReasonOf(result);
  if (why) openUpgrade(why);
  return result;
}
