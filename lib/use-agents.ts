"use client";

import { useEffect, useSyncExternalStore } from "react";
import { BUILT_IN_AGENTS, type AgentInfo } from "./agents";
import { api } from "./client";

// Every agent and each project's default, for the board's pickers and marks (the New thread dialog, the card menu, the
// card footer) and Settings → Agents. One copy for the whole window, read once and again whenever Settings changes it.
// Until it loads, or where there's no Weft server to ask (weft.zip), it's the built-ins as they shipped and no defaults.

export interface AgentList {
  agents: AgentInfo[];
  // A project's default agent by folder; a folder left out starts on Builder.
  projects: Record<string, string>;
}

const SHIPPED: AgentList = { agents: BUILT_IN_AGENTS, projects: {} };
let list: AgentList = SHIPPED;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

// Puts a changed list in place now (Settings has it already), so every picker follows without a round trip.
export function showAgents(next: Partial<AgentList>) {
  list = { ...list, ...next };
  for (const l of listeners) l();
}

export function refreshAgents(): Promise<void> {
  // A board with no agents route to ask (weft.zip, an older server) keeps the shipped list.
  loading = Promise.resolve().then(() => api.agents()).then(showAgents, () => {});
  return loading;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useAgentList(): AgentList {
  useEffect(() => {
    if (!loading) void refreshAgents();
  }, []);
  return useSyncExternalStore(subscribe, () => list, () => SHIPPED);
}

export const useAgents = (): AgentInfo[] => useAgentList().agents;

// For tests: back to the shipped list, not yet read.
export function forgetAgentList() {
  list = SHIPPED;
  loading = null;
}
