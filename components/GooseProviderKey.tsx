"use client";

// Settings → Models → "Bring your own key": the provider and model new Goose threads run on,
// and the key each provider reads. The key goes to Electron main once and is sealed in the
// Keychain; the board only ever learns whether a key is saved.
//
// The chosen provider and model are board settings, so a new Goose thread inherits them
// (lib/goose-provider.ts, lib/goose-launch.ts). The key never comes back to the board.
//
// One provider is on screen at a time — the chosen one — so the section stays compact on a small
// screen. The list under it says which other providers already have a key saved, with a Forget
// for each.

import { GOOSE_PROVIDERS, PUKU_GOOSE, type GooseProviderView } from "@/lib/goose-provider";
import { useGooseProviders } from "@/lib/use-goose";
import { useGooseSelection } from "@/lib/use-goose-selection";
import GooseKeyRow from "./GooseKeyRow";
import GooseSavedKeys from "./GooseSavedKeys";

export interface GooseProviderKeyProps {
  // The chosen provider, model and endpoint, from the server's settings.
  providerId: string;
  modelId: string;
  baseUrl: string;
}

// The catalog on disk is the board's copy; main's list is what has keys saved. A provider main
// doesn't know yet (an older board) falls back to the catalog's own entry.
function rowsFrom(providers: GooseProviderView[]): GooseProviderView[] {
  return GOOSE_PROVIDERS.map((p) => {
    const live = providers.find((v) => v.id === p.id);
    return {
      id: p.id,
      label: p.label,
      envKey: p.envKey,
      hasKey: Boolean(live?.hasKey),
      baseUrl: live?.baseUrl,
      model: live?.model,
      savedAt: live?.savedAt,
      models: live?.models ?? p.models,
      note: live?.note ?? p.note ?? null,
      freeModel: live?.freeModel ?? p.freeModel,
    };
  });
}

export default function GooseProviderKey({ providerId, modelId, baseUrl }: GooseProviderKeyProps) {
  const { providers, error, busy, setKey, forget } = useGooseProviders();
  const selection = useGooseSelection({ providerId, modelId, baseUrl });
  const rows = rowsFrom(providers);

  // The provider on screen: the chosen one, or the first until one is picked.
  const open = rows.find((r) => r.id === selection.providerId) ?? rows[0];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[13px] font-medium text-ink">Bring your own key</h3>
        <p className="text-[12.5px] text-muted">
          {error ??
            selection.error ??
            "The provider and model new Goose threads use. Paste a key and Weft keeps it in your Keychain — it never reaches the board."}
        </p>
      </div>

      <label className="flex items-center gap-2">
        <span className="w-[70px] shrink-0 text-[11.5px] text-muted">Provider</span>
        <select
          value={open?.id ?? ""}
          onChange={(e) => selection.setProvider(e.target.value)}
          aria-label="Goose provider"
          className="rounded-md border border-line-strong bg-canvas px-2.5 py-[7px] text-[12.5px] text-ink outline-none focus:border-accent"
        >
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
              {r.hasKey ? " — key saved" : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => selection.setAll(PUKU_GOOSE)}
          disabled={busy || selection.busy}
          className="shrink-0 rounded-md border border-line-strong px-2 py-[6px] text-[11.5px] text-muted hover:text-ink disabled:opacity-40"
          aria-label="Use Puku"
          title="Use Puku's gateway: the Anthropic provider, api-cli.puku.sh and puku-ai-2.8"
        >
          {PUKU_GOOSE.label}
        </button>
      </label>

      {open && (
        <GooseKeyRow
          provider={open}
          selected={Boolean(selection.providerId)}
          model={selection.modelId || (open.model ?? "")}
          baseUrl={selection.baseUrl}
          models={open.models ?? []}
          freeModel={open.freeModel}
          busy={busy || selection.busy}
          onSelect={(id) => selection.setProvider(id)}
          onModel={(_, model) => selection.setModel(model)}
          onBaseUrl={(_, url) => selection.setBaseUrl(url)}
          onSaveKey={(id, token, extra) => setKey(id, token, extra)}
          onForget={(id) => forget(id)}
        />
      )}

      <GooseSavedKeys rows={rows} busy={busy} onUse={(id) => selection.setProvider(id)} />
    </section>
  );
}
