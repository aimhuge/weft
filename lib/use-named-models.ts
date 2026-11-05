"use client";

import { useEffect, useSyncExternalStore } from "react";
import { apiFetch } from "./api-client";

// What a model menu needs from Settings → Models: the names the user gave their models, and the
// Goose provider they set up (so the menu lists that provider's models, not another's).
//
// The board reads these from /api/settings rather than importing lib/goose-models.ts, which reads
// the settings file off disk with node:fs — a browser chunk can't hold that, so importing it took
// the whole board down (lib/client-graph.ts's leak check).

// One named model: the id that runs, and the name the user reads.
export interface NamedModel {
  id: string;
  name: string;
}

// The Goose setup the menu lists models for.
export interface GooseChoice {
  providerId: string;
  modelId: string;
}

let named: NamedModel[] = [];
let goose: GooseChoice = { providerId: "", modelId: "" };
let loaded = false;
const listeners = new Set<() => void>();

function publish(models: NamedModel[], choice: GooseChoice) {
  named = models;
  goose = choice;
  loaded = true;
  for (const listener of listeners) listener();
}

export function loadNamedModels(): Promise<void> {
  return apiFetch("/api/settings")
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { gooseNamedModels?: NamedModel[]; gooseProviderId?: string; gooseModelId?: string } | null) => {
      publish(body?.gooseNamedModels ?? [], {
        providerId: body?.gooseProviderId ?? "",
        modelId: body?.gooseModelId ?? "",
      });
    })
    .catch(() => {
      // The settings route isn't there (the web board): no names, and the menu shows the raw ids.
      publish([], { providerId: "", modelId: "" });
    });
}

// The named models the server last sent, empty until it answers.
export function useNamedModels(): NamedModel[] {
  useEffect(() => {
    if (!loaded) void loadNamedModels();
  }, []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => named,
    () => [] as NamedModel[],
  );
}

/** The Goose provider the user set up and the model it runs, empty until the server answers. */
export function useGooseChoice(): GooseChoice {
  useEffect(() => {
    if (!loaded) void loadNamedModels();
  }, []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => goose,
    () => ({ providerId: "", modelId: "" }),
  );
}

// For tests: forget what was loaded, so the next hook asks the route again.
export function resetNamedModels() {
  named = [];
  goose = { providerId: "", modelId: "" };
  loaded = false;
}
