"use client";

// One row of the team's device list: the machine's name, what it runs, when we last heard from it, and
// the fingerprint that identifies it. The fingerprint is the point — it's what the user reads out to a
// teammate, and what a teammate reads back to compare.
//
// Nothing secret is in this row: a public key and a fingerprint are metadata, and the vault key never
// comes near the web side. The row also says whose machine it is, so an admin can tell their own
// laptop from a teammate's.

import { lastSeenLabel, platformLabel } from "@/lib/team-devices-view";
import type { TeamDevice } from "@/lib/team-devices-view";

export function DeviceRow({ device, isYou }: { device: TeamDevice; isYou: boolean }) {
  const revoked = Boolean(device.revokedAt);
  return (
    <tr className={revoked ? "wz-deviceRow wz-deviceRowRevoked" : "wz-deviceRow"}>
      <td>
        <div className="wz-deviceWho">
          <span className="wz-deviceName">{device.name}</span>
          <span className="wz-deviceOwner">{isYou ? "You" : (device.ownerName ?? "Someone in the workspace")}</span>
        </div>
      </td>
      <td className="wz-devicePlatform">{platformLabel(device.platform)}</td>
      <td className="wz-deviceSeen">{revoked ? "Revoked" : lastSeenLabel(device.lastSeenAt)}</td>
      <td>
        <code className="wz-deviceFingerprint">{device.fingerprint}</code>
      </td>
    </tr>
  );
}
