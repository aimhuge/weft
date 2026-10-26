"use client";

import { useEffect, useSyncExternalStore } from "react";
import { apiFetch } from "./api-client";

// The models the user gave a name to, so a model menu shows a name instead of a raw id
// (lib/goose-models.ts). The board reads them from /api/settings rather than importing
// lib/goose-models.ts, which reads the settings file off disk with node:fs — a browser chunk can't
// hold that, so importing it took the whole board down (lib/client-graph.ts's leak check).

// One named model: the id that runs, and the name the user reads.
export interface NamedModel {
  id: string;
  name: string;
}

let named: NamedModel[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function publish(models: NamedModel[]) {
  named = models;
  loaded = true;
  for (const listener of listeners) listener();
}

export function loadNamedModels(): Promise<void> {
  return apiFetch("/api/settings")
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { gooseNamedModels?: NamedModel[] } | null) => {
      publish(body?.gooseNamedModels ?? []);
    })
    .catch(() => {
      // The settings route isn't there (the web board): no names, and the menu shows the raw ids.
      publish([]);
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

// For tests: forget what was loaded, so the next hook asks the route again.
export function resetNamedModels() {
  named = [];
  loaded = false;
}
