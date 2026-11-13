"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api-client";
import { markPhonePromptSeen, phonePromptSeen, shouldOfferPhone } from "./phone-prompt";
import type { InviteAnswer, TestflightInfo } from "./testflight-types";
import { useAccount } from "./use-account";
import { starAskedThisLaunch } from "./star-prompt";
import { syncAskedThisLaunch } from "./use-sync-prompt";
import { loadWelcome } from "./welcome-client";

// The phone app's TestFlight on the board (docs/architecture/mobile.md#testflight): the public link through the local
// /api/account/testflight (weft.zip answers it), and the invite emailed to the signed-in account.

export const loadTestflight = (): Promise<TestflightInfo | null> =>
  apiFetch("/api/account/testflight")
    .then((r) => (r.ok ? (r.json() as Promise<TestflightInfo | null>) : null))
    .catch(() => null);

export const inviteMe = (): Promise<InviteAnswer> =>
  apiFetch("/api/account/testflight", { method: "POST" })
    .then((r) => r.json() as Promise<InviteAnswer>)
    .catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }));

const phoneCount = (): Promise<number | null> =>
  apiFetch("/api/push-devices")
    .then((r) => (r.ok ? (r.json() as Promise<{ devices?: unknown[] }>) : null))
    .then((v) => (v?.devices ? v.devices.length : null))
    .catch(() => null);

// Pair a phone's "No Weft app yet?" line: the link, or null while it loads or when there isn't one.
export function useTestflightLink(): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadTestflight().then((info) => live && setUrl(info?.url ?? null));
    return () => {
      live = false;
    };
  }, []);
  return url;
}

// Once a launch: the flag lives in the module, so the badges remounting doesn't ask twice.
let offeredThisLaunch = false;

// Whether it opened this launch, so the star ask (lib/use-star-prompt.ts) waits for another one.
export const phoneOfferedThisLaunch = () => offeredThisLaunch;

// When the "Weft on your phone" prompt opens (lib/phone-prompt.ts has the rules). Nothing is fetched until the cheap
// local checks pass, then the welcome, the phones and the link are read once.
export function usePhonePrompt(finished: number) {
  const { state } = useAccount();
  const signedIn = state.kind === "ready" && !!state.view.user;
  const [open, setOpen] = useState<TestflightInfo | null>(null);

  useEffect(() => {
    const gate = { signedIn, welcomed: true, seen: phonePromptSeen(), finished, syncAsked: syncAskedThisLaunch(), phones: 0, url: "x" };
    if (offeredThisLaunch || !shouldOfferPhone(gate)) return;
    let live = true;
    void Promise.all([loadWelcome().then((v) => Boolean(v.welcome)), phoneCount(), loadTestflight()])
      .then(([welcomed, phones, info]) => {
        const url = info?.url ?? null;
        if (!live || offeredThisLaunch) return;
        if (!shouldOfferPhone({ ...gate, welcomed, phones, url, seen: phonePromptSeen(), syncAsked: syncAskedThisLaunch() || starAskedThisLaunch() })) return;
        offeredThisLaunch = true;
        setOpen(info);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [signedIn, finished]);

  const close = useCallback(() => {
    markPhonePromptSeen();
    setOpen(null);
  }, []);

  return { url: open?.url ?? null, invites: open?.invites ?? false, close };
}

// Tests only: a fresh launch.
export function resetOfferedForTests() {
  offeredThisLaunch = false;
}
