"use client";

// The chosen provider's row in Settings → Models → "Bring your own key": which provider it is,
// the key input, the Save and Forget buttons, and the endpoint and model fields the provider
// needs.
//
// The key never comes back: it goes to Electron main once and is sealed in the Keychain, so the
// input is cleared after a save and the value is never read back into state. What the row shows
// instead is the provider's saved state (hasKey) and the non-secret metadata beside it.

import { useState } from "react";
import { keyForgottenText, keySavedText, needsBaseUrl, type GooseProviderView } from "@/lib/goose-provider";
import GooseModelField from "./GooseModelField";
import { SMALL } from "./tone";

export interface GooseKeyRowProps {
  provider: GooseProviderView;
  // The chosen provider and model, for the row's pickers.
  selected: boolean;
  model: string;
  baseUrl: string;
  // The models this provider offers; empty means the user types one.
  models: string[];
  // True when the provider takes any model id: the field is a text box with the known ids as
  // suggestions, not a fixed list. A gateway behind Anthropic's API serves its own ids.
  freeModel?: boolean;
  busy: boolean;
  onSelect: (providerId: string) => void;
  onModel: (providerId: string, model: string) => void;
  onBaseUrl: (providerId: string, baseUrl: string) => void;
  onSaveKey: (providerId: string, token: string, extra: { baseUrl?: string; model?: string }) => Promise<boolean>;
  onForget: (providerId: string) => Promise<boolean>;
}

const INPUT_CLASS =
  "w-full rounded-md border border-line-strong bg-canvas px-2.5 py-[7px] text-[12.5px] text-ink outline-none focus:border-accent";

export default function GooseKeyRow({
  provider,
  selected,
  model,
  baseUrl,
  models,
  freeModel = false,
  busy,
  onSelect,
  onModel,
  onBaseUrl,
  onSaveKey,
  onForget,
}: GooseKeyRowProps) {
  const [token, setToken] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const wantsUrl = needsBaseUrl(provider.id);

  async function saveKey() {
    const value = token.trim();
    if (!value) {
      setNote("Paste the key first.");
      return;
    }
    setNote(null);
    const extra: { baseUrl?: string; model?: string } = {};
    if (wantsUrl && baseUrl.trim()) extra.baseUrl = baseUrl.trim();
    if (model.trim()) extra.model = model.trim();
    const ok = await onSaveKey(provider.id, value, extra);
    if (ok) {
      // The key is gone from the board now: clear the input so it can't be read back.
      setToken("");
      setNote(keySavedText(provider));
    }
  }

  async function forgetKey() {
    setNote(null);
    const ok = await onForget(provider.id);
    if (ok) setNote(keyForgottenText(provider));
  }

  return (
    <div className="flex flex-col gap-2">
      <GooseKeyHeader
        provider={provider}
        selected={selected}
        busy={busy}
        onSelect={onSelect}
        onForget={() => void forgetKey()}
      />

      {provider.note && <p className="text-[11.5px] text-faint">{provider.note}</p>}

      <div className="flex items-center gap-2">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={provider.hasKey ? "Paste a new key to replace it" : `Paste the ${provider.label} key`}
          aria-label={`${provider.label} API key`}
          autoComplete="off"
          spellCheck={false}
          className={INPUT_CLASS}
        />
        <button
          type="button"
          onClick={() => void saveKey()}
          disabled={busy}
          className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-on-accent disabled:opacity-40"
          aria-label={`Save the ${provider.label} key`}
        >
          Save key
        </button>
      </div>

      {wantsUrl && (
        <label className="flex items-center gap-2">
          <span className="w-[70px] shrink-0 text-[11.5px] text-muted">Base URL</span>
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => onBaseUrl(provider.id, e.target.value)}
            // Anthropic's provider takes the host itself: Goose appends "v1/messages", so a host
            // with "/v1" would ask for "/v1/v1/messages".
            placeholder={provider.id === "anthropic" ? "https://api-cli.puku.sh" : "https://your-endpoint.example.com/v1"}
            aria-label={`${provider.label} base URL`}
            spellCheck={false}
            className={INPUT_CLASS}
          />
        </label>
      )}

      <GooseModelField
        providerId={provider.id}
        providerLabel={provider.label}
        model={model}
        models={models}
        freeModel={freeModel}
        onModel={onModel}
      />

      {note && <p className="text-[11.5px] text-muted">{note}</p>}
    </div>
  );
}

/**
 * The row's head: which provider it is, whether its key is saved, and the Use and Forget buttons.
 */
function GooseKeyHeader({
  provider,
  selected,
  busy,
  onSelect,
  onForget,
}: {
  provider: GooseProviderView;
  selected: boolean;
  busy: boolean;
  onSelect: (providerId: string) => void;
  onForget: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-[12.5px] font-medium text-ink">{provider.label}</span>
        <span className="text-[11px] text-faint">{provider.envKey}</span>
        {provider.hasKey ? (
          <span className="rounded bg-ok-soft px-1.5 py-0.5 text-[11px] text-ok">Key saved</span>
        ) : (
          <span className="rounded bg-sunken px-1.5 py-0.5 text-[11px] text-muted">No key</span>
        )}
        {selected && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent">In use</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!selected && (
          <button
            type="button"
            onClick={() => onSelect(provider.id)}
            disabled={busy}
            className={`${SMALL} shrink-0`}
            aria-label={`Use ${provider.label} for Goose threads`}
          >
            Use
          </button>
        )}
        {provider.hasKey && (
          <button
            type="button"
            onClick={onForget}
            disabled={busy}
            className={`${SMALL} shrink-0`}
            aria-label={`Forget the ${provider.label} key`}
          >
            Forget
          </button>
        )}
      </div>
    </div>
  );
}
