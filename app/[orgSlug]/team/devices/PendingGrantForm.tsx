"use client";

// The pending device grants: the requests waiting for the other machine to show the same fingerprint.
//
// Each row is one request — who asked, for whose machine, for which vault, and the fingerprint the two
// sides have to agree on. A "Cancel" button drops the request: the granter changed their mind, or the
// target doesn't want that machine added. Nothing was sealed yet, so cancelling is just a row going
// away.
//
// The fingerprint is shown, not hidden: the user has to read it to the other side somehow (over voice,
// or by showing the screen), and the whole point of the check is that they compare the two strings
// themselves.

import { useState, useTransition } from "react";
import { lastSeenLabel } from "@/lib/team-devices-view";
import type { PendingDeviceGrant } from "@/lib/team-devices-view";
import { deletePendingGrant } from "./client";

export function PendingGrantForm({ org, grants, viewerId }: { org: string; grants: PendingDeviceGrant[]; viewerId: string }) {
  if (grants.length === 0) return null;
  return (
    <div className="wz-pendingList" role="list">
      {grants.map((grant) => (
        <PendingGrantRow key={grant.id} org={org} grant={grant} isTarget={grant.targetUserId === viewerId} />
      ))}
    </div>
  );
}

function PendingGrantRow({ org, grant, isTarget }: { org: string; grant: PendingDeviceGrant; isTarget: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function handleCancel() {
    startTransition(async () => {
      const result = await deletePendingGrant({ org, pendingId: grant.id });
      setMessage(
        result.ok
          ? { ok: true, text: "Cancelled." }
          : { ok: false, text: result.error ?? "Couldn't cancel." },
      );
    });
  }

  const who = isTarget ? "your machine" : (grant.targetName ?? "a teammate's machine");

  return (
    <>
      <div className="wz-pendingRow wz-devicePendingRow">
        <div className="wz-devicePendingWho">
          <span className="wz-devicePendingHeadline">
            {grant.granterName ?? "Someone"} asked to add {who} to {grant.vaultLabel || "a vault"}
          </span>
          <code className="wz-deviceFingerprint">{grant.fingerprint}</code>
          <span className="wz-devicePendingWhen">asked {lastSeenLabel(grant.createdAt)}</span>
        </div>
        <button type="button" className="wz-pendingRevoke" onClick={handleCancel} disabled={pending}>
          {pending ? "Working…" : "Cancel"}
        </button>
      </div>
      {message ? (
        <div className="wz-pendingRow" style={{ paddingTop: 0, paddingBottom: 6 }}>
          <span className={`wz-rosterMessage ${message.ok ? "wz-rosterMessageOk" : "wz-rosterMessageError"}`} style={{ gridColumn: "1 / -1" }}>
            {message.text}
          </span>
        </div>
      ) : null}
    </>
  );
}
