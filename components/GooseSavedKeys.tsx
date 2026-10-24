"use client";

// The providers that already have a key saved in the Keychain, under Settings → Models →
// "Bring your own key". Each row says which provider it is and offers one thing: use it (it
// becomes the provider new Goose threads run on). Forgetting a key happens in that provider's own
// row above, so the saved list stays a list and not a second copy of the form.
//
// This is the saved list, not the catalog: a provider with no key isn't drawn here, so the list
// stays short no matter how many providers the catalog has.

import type { GooseProviderView } from "@/lib/goose-provider";
import { SMALL } from "./tone";

export interface GooseSavedKeysProps {
  rows: GooseProviderView[];
  busy: boolean;
  onUse: (providerId: string) => void;
}

export default function GooseSavedKeys({ rows, busy, onUse }: GooseSavedKeysProps) {
  const saved = rows.filter((r) => r.hasKey);
  if (saved.length === 0) {
    return <p className="text-[11.5px] text-faint">No provider has a key saved yet.</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11.5px] text-faint">Keys saved in your Keychain</p>
      {saved.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-3">
          <span className="truncate text-[12px] text-muted">{r.label}</span>
          <button type="button" onClick={() => onUse(r.id)} disabled={busy} className={`${SMALL} shrink-0`} aria-label={`Use ${r.label}`}>
            Use
          </button>
        </div>
      ))}
    </div>
  );
}
