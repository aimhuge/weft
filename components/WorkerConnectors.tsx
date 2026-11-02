"use client";

// A paired worker's connectors on Settings → Devices (lib/use-worker-connectors.ts): Google (gog) and GitHub (gh), each
// a toggle on the worker's own row, so no new row of chips. On asks Touch ID in main and lends the account; off makes
// the worker forget its token. Google picks among the accounts gog has on this Mac when there's more than one.
import { useState } from "react";
import type { DeviceView } from "@/lib/device-registry";
import { CONNECTOR_LABEL, type Connector, type useWorkerConnectors } from "@/lib/use-worker-connectors";

const TOGGLE = "rounded-md border px-2 py-0.5 text-[12px] disabled:opacity-50";

export default function WorkerConnectors({ device, connectors }: { device: DeviceView; connectors: ReturnType<typeof useWorkerConnectors> }) {
  const [account, setAccount] = useState("");
  if (!connectors.available || !device.hasSignKey) return null;
  const google = account || connectors.google[0] || "";
  const button = (c: Connector) => {
    const on = connectors.isOn(device.id, c);
    const off = c === "gog" && !on && !google;
    return (
      <button
        type="button"
        disabled={off}
        aria-pressed={Boolean(on)}
        className={`${TOGGLE} ${on ? "border-accent bg-accent/10 text-ink" : "border-line-strong text-muted hover:bg-sunken"}`}
        title={on ? `${CONNECTOR_LABEL[c]} as ${on.account}: click to take it back` : off ? "Sign a Google account in at Settings → Connectors first" : `Lend ${device.name} your ${CONNECTOR_LABEL[c]} sign-in, after Touch ID`}
        onClick={() => void connectors.toggle(device.id, device.name, c, c === "gog" ? google : undefined)}
      >
        {CONNECTOR_LABEL[c]}
      </button>
    );
  };
  return (
    <span className="flex items-center gap-1" aria-label={`${device.name}'s connectors`}>
      {connectors.google.length > 1 && !connectors.isOn(device.id, "gog") && (
        <select aria-label="Google account" className="max-w-[9rem] rounded-md border border-line-strong bg-transparent px-1 py-0.5 text-[12px] text-ink" value={google} onChange={(e) => setAccount(e.target.value)}>
          {connectors.google.map((email) => (
            <option key={email} value={email}>
              {email}
            </option>
          ))}
        </select>
      )}
      {button("gog")}
      {button("gh")}
    </span>
  );
}
