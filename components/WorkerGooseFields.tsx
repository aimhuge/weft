"use client";

// Goose's provider and endpoint on one of your workers (docs/architecture/weft-worker.md#goose-on-a-worker), inside
// Settings → Threads' "On a worker". They say where a Goose card's traffic goes, so Save asks Touch ID and this Mac signs
// exactly that change (lib/worker-host-settings.ts); the worker checks it against the key it pinned. Only a worker that
// reports them (a newer one) shows them. The provider's key never travels: see the hint.
import type { HostSettings } from "@weft/client";
import { GOOSE_PROVIDERS, needsBaseUrl } from "@/lib/goose-provider";
import { canSignWiden } from "@/lib/widen-signer";
import { SELECT_CLASS } from "./ModelSelect";

type Set = <K extends keyof HostSettings>(key: K, value: HostSettings[K]) => void;

export default function WorkerGooseFields({ form, set }: { form: HostSettings; set: Set }) {
  if (form.gooseProviderId === undefined) return null;
  const provider = form.gooseProviderId;
  const signer = canSignWiden();
  const showUrl = needsBaseUrl(provider) || Boolean(form.gooseBaseUrl);
  return (
    <>
      <label className="flex items-center justify-between gap-4 text-[13px] text-ink">
        Goose provider
        <select aria-label="Goose provider" value={provider} disabled={!signer} onChange={(e) => set("gooseProviderId", e.target.value)} className={SELECT_CLASS}>
          <option value="">Goose&apos;s own</option>
          {GOOSE_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {showUrl && (
        <label className="flex items-center justify-between gap-4 text-[13px] text-ink">
          Goose endpoint
          <input aria-label="Goose endpoint" value={form.gooseBaseUrl ?? ""} disabled={!signer} placeholder="https://…" onChange={(e) => set("gooseBaseUrl", e.target.value)} className={`${SELECT_CLASS} w-56`} />
        </label>
      )}
      <p className="text-[11.5px] text-muted">
        {signer ? "Saving these asks Touch ID: they change where a Goose card's traffic goes." : "Changing these needs Touch ID in the Weft desktop app."} The provider&apos;s key isn&apos;t sent to the worker.
      </p>
    </>
  );
}
