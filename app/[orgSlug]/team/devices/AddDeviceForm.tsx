"use client";

// The "add a device" form on the team's Devices page. An admin pastes the fingerprint of the machine
// they want to add, says whose machine it is and which vault it should open, and presses Add.
//
// What this does NOT do is add the device. It asks: the server writes a `pending_device_grants` row
// and waits. The other machine hears about it, the two users compare the fingerprint out of band, and
// only then is the vault key sealed to the new machine. The form says so, because "I pressed Add and
// nothing happened" is the confusing outcome otherwise.
//
// The same form covers "Add this device" — a second machine on the same person's account is its own
// TOFU check, so the only difference is that the target member is the person sitting at this screen.

import { useState, useTransition, type SubmitEvent } from "react";
import { isValidFingerprint } from "@/lib/team-devices-view";
import { createPendingGrant } from "./client";

export type VaultOption = { id: string; label: string; repo: string };
export type MemberOption = { id: string; name: string; email: string | null };

export function AddDeviceForm({
  org,
  vaults,
  members,
  viewerId,
  title,
}: {
  org: string;
  vaults: VaultOption[];
  members: MemberOption[];
  viewerId: string;
  title: string;
}) {
  const [vaultId, setVaultId] = useState(vaults[0]?.id ?? "");
  const [targetUserId, setTargetUserId] = useState(viewerId);
  const [fingerprint, setFingerprint] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const ready = Boolean(vaultId && targetUserId) && isValidFingerprint(fingerprint);

  function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ready) return;
    startTransition(async () => {
      const result = await createPendingGrant({ org, vaultId, targetUserId, fingerprint });
      setMessage(
        result.ok
          ? { ok: true, text: "Asked. The other machine has to show the same fingerprint before anything is shared." }
          : { ok: false, text: result.error ?? "Couldn't add the device." },
      );
      if (result.ok) setFingerprint("");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="wz-inviteForm" noValidate>
      <h3 className="wz-deviceFormTitle">{title}</h3>
      <div className="wz-inviteRow">
        <div className="wz-inviteField">
          <label htmlFor="device-vault">Vault</label>
          <select
            id="device-vault"
            name="vaultId"
            className="wz-inviteSelect"
            value={vaultId}
            onChange={(e) => setVaultId(e.target.value)}
            disabled={pending || vaults.length === 0}
          >
            {vaults.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} — {v.repo}
              </option>
            ))}
          </select>
        </div>
        <div className="wz-inviteField">
          <label htmlFor="device-target">Whose machine</label>
          <select
            id="device-target"
            name="targetUserId"
            className="wz-inviteSelect"
            value={targetUserId}
            onChange={(e) => setTargetUserId(e.target.value)}
            disabled={pending}
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.email ? ` — ${m.email}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="wz-inviteField">
        <label htmlFor="device-fingerprint">Fingerprint</label>
        <input
          id="device-fingerprint"
          name="fingerprint"
          type="text"
          className="wz-inviteInput wz-deviceFingerprintInput"
          value={fingerprint}
          onChange={(e) => setFingerprint(e.target.value)}
          placeholder="a1b2 c3d4 e5f6 7890 abcd ef01 2345 6789"
          autoComplete="off"
          spellCheck={false}
          required
          disabled={pending}
        />
        <p className="wz-inviteRoleDescription">On the other machine: Weft → Settings → Devices → Show fingerprint. Copy the whole string.</p>
      </div>
      <div>
        <button type="submit" className="wz-inviteSubmit" disabled={pending || !ready}>
          {pending ? "Sending…" : "Add"}
        </button>
      </div>
      {message ? (
        <p className={`wz-inviteMessage ${message.ok ? "wz-inviteMessageOk" : "wz-inviteMessageError"}`} role={message.ok ? "status" : "alert"}>
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
