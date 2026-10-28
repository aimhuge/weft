"use client";

// The browser-side calls to the team's Devices API (app/api/team/devices). These run on weft.zip, where
// the visitor's Supabase session is a cookie, so a same-origin fetch carries the identity by itself —
// no x-weft-token here (that header is the desktop's local API's guard, not this one).
//
// Every call answers with { ok: … } or { error: "…" }, and the helpers turn a failure into a message
// the form can show, so a component never has to look at a status code.

export type DeviceResult = { ok: boolean; error?: string };

// POST or DELETE a JSON body to one of the device routes.
async function send(method: "POST" | "DELETE", url: string, body: unknown): Promise<DeviceResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json().catch(() => ({}))) as { ok?: unknown; error?: unknown };
    if (!res.ok) {
      const error = typeof parsed.error === "string" ? parsed.error : `Weft's device API answered ${res.status}.`;
      return { ok: false, error };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach weft.zip." };
  }
}

// Ask to add a device to one of the workspace's vaults. The fingerprint is the TOFU token: the user
// copied it off the other machine's Weft, and the other machine has to show the same string.
export function createPendingGrant(body: { org: string; vaultId: string; targetUserId: string; fingerprint: string }): Promise<DeviceResult> {
  return send("POST", "/api/team/devices", body);
}

// Drop a pending grant — the granter changed their mind, or the target doesn't want the device.
export function deletePendingGrant(body: { org: string; pendingId: string }): Promise<DeviceResult> {
  return send("DELETE", "/api/team/devices", body);
}
