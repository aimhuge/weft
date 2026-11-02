"use client";

// The terminal drawer's open state (components/BoardBottom.tsx). On this Mac's folders the drawer follows the board: open
// it once and each card or project you pick shows its own shells. A worker's terminal is different: opening it asks
// Touch ID and starts a shell on another machine over its line (lib/line-terminal.ts), so it shows only for the target
// you opened the drawer on. Picking a worker card while the drawer is open for something else hides it instead of
// opening one there; nothing opens a worker's terminal but your own toggle (the header button, "t", Ctrl+`).
import { useCallback, useState } from "react";
import { terminalAway } from "./board-derive";
import { isWorkerProject, type WorkerProject } from "./worker-project";

const DEFAULT_HEIGHT = 240;

// What the drawer would show that only an explicit toggle may open: a worker project's terminal, or the "not here"
// notice for a card on a worker this Mac can't sign for. Null for this Mac's own folders.
export function remoteTarget(cwd: string, away: string | null): string | null {
  if (away) return `away:${away}`;
  return isWorkerProject(cwd) ? cwd : null;
}

// Whether the drawer shows: open, and either on this Mac's folders or on the remote target it was opened for.
export function drawerShown(open: boolean, target: string | null, openedFor: string | null): boolean {
  return open && (target === null || target === openedFor);
}

export interface TerminalDrawerInput {
  cwd: string;
  openWorker: { name: string } | null | undefined;
  project: string | null;
  projects: readonly WorkerProject[];
  cardOpen: boolean;
}

export function useTerminalDrawer({ cwd, openWorker, project, projects, cardOpen }: TerminalDrawerInput) {
  const [state, setState] = useState<{ open: boolean; openedFor: string | null }>({ open: false, openedFor: null });
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const away = terminalAway(openWorker, project, projects, cardOpen, isWorkerProject(cwd));
  const target = remoteTarget(cwd, away);
  const open = drawerShown(state.open, target, state.openedFor);
  const toggle = useCallback(() => setState(open ? { open: false, openedFor: null } : { open: true, openedFor: target }), [open, target]);
  // The worker's name, for what the drawer says when its terminal can't open ("m1mini needs to update…").
  const host = projects.find((p) => p.path === cwd)?.worker ?? null;
  return { open, height, setHeight, toggle, away, host };
}
