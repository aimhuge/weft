"use client";

// Which Goose provider and model new Goose threads use, and the endpoint for the providers that
// need one. The choice is a board setting (lib/settings.ts), so a new thread inherits it; the key
// itself stays in Electron main's Keychain and is never part of this.
//
// The three fields travel together: picking a provider that needs an endpoint asks for the
// endpoint, and the model list follows the provider.

import { useCallback, useState } from "react";
import { api } from "./client";
import { needsBaseUrl } from "./goose-provider";

export interface GooseSelection {
  // The chosen provider's id; "" means none picked yet.
  providerId: string;
  // The chosen model id; "" means the provider's own default.
  modelId: string;
  // The endpoint for custom / azure / litellm; "" means none.
  baseUrl: string;
  // The message under the row: why the last save failed, or null.
  error: string | null;
  // True while a save is in flight.
  busy: boolean;
  setProvider: (providerId: string) => void;
  setModel: (modelId: string) => void;
  setBaseUrl: (baseUrl: string) => void;
  // Sets the provider, model and endpoint together, in one save.
  setAll: (next: { providerId: string; modelId: string; baseUrl: string }) => void;
  // Whether the chosen provider has to be given an endpoint before it can run.
  needsUrl: boolean;
}

export interface GooseSelectionOptions {
  providerId: string;
  modelId: string;
  baseUrl: string;
  // Called after a field is saved, so the caller can refresh its own view of the settings.
  onSaved?: () => void;
}

/**
 * The chosen Goose provider, model and endpoint, each saved as it changes. A field that fails to
 * save goes back to what the server holds, so the UI never shows a choice the server didn't take.
 */
export function useGooseSelection({ providerId, modelId, baseUrl, onSaved }: GooseSelectionOptions): GooseSelection {
  const [provider, setProviderState] = useState(providerId);
  const [model, setModelState] = useState(modelId);
  const [url, setUrlState] = useState(baseUrl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Saves one field, and puts it back if the server refused it.
  const save = useCallback(
    (patch: { gooseProviderId?: string; gooseModelId?: string; gooseBaseUrl?: string }, revert: () => void) => {
      setError(null);
      setBusy(true);
      api.saveSettings(patch).then(
        () => {
          setBusy(false);
          onSaved?.();
        },
        (err: unknown) => {
          setBusy(false);
          revert();
          setError(`Couldn’t save: ${err instanceof Error ? err.message : String(err)}`);
        },
      );
    },
    [onSaved],
  );

  const setProvider = useCallback(
    (next: string) => {
      const before = provider;
      setProviderState(next);
      // A provider that needs an endpoint inherits the one already typed; one that doesn't
      // keeps it, so switching back and forth doesn't lose the user's URL.
      save({ gooseProviderId: next }, () => setProviderState(before));
    },
    [provider, save],
  );

  const setModel = useCallback(
    (next: string) => {
      const before = model;
      setModelState(next);
      save({ gooseModelId: next }, () => setModelState(before));
    },
    [model, save],
  );

  const setBaseUrl = useCallback(
    (next: string) => {
      const before = url;
      setUrlState(next);
      save({ gooseBaseUrl: next }, () => setUrlState(before));
    },
    [url, save],
  );

  // Sets all three at once, in one save: a preset picks a provider, a model and an endpoint
  // together, and three separate saves would show half a preset for a moment.
  const setAll = useCallback(
    (next: { providerId: string; modelId: string; baseUrl: string }) => {
      const before = { provider, model, url };
      setProviderState(next.providerId);
      setModelState(next.modelId);
      setUrlState(next.baseUrl);
      save(
        { gooseProviderId: next.providerId, gooseModelId: next.modelId, gooseBaseUrl: next.baseUrl },
        () => {
          setProviderState(before.provider);
          setModelState(before.model);
          setUrlState(before.url);
        },
      );
    },
    [provider, model, url, save],
  );

  return {
    providerId: provider,
    modelId: model,
    baseUrl: url,
    error,
    busy,
    setProvider,
    setModel,
    setBaseUrl,
    setAll,
    // Whether the chosen provider has to be given an endpoint before it can run.
    needsUrl: needsBaseUrl(provider),
  };
}
