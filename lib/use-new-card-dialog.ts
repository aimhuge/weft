"use client";

// The New thread dialog's state, draft, defaults and submit behavior. Extracted from
// components/NewCardDialog.tsx so the dialog body and its logic can change on their own schedule.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type NewCardInput } from "@/lib/client";
import type { Backend, Effort, PermissionMode } from "@/lib/types";
import {
  bareModel,
  DRAFT,
  LAST_BACKEND,
  LAST_CWD,
  effortFor,
  errorText,
  headline,
  lastEffort,
  modelFor,
  NO_MODEL,
  problemWith,
  remember,
  rememberPicks,
  remembered,
  resolveModel,
  setModelFor,
  subscribeDefaults,
} from "@/lib/new-thread";
import { useIsolate } from "./use-isolate";
import type { ThreadAgent } from "./agents";
import { useAgentList } from "./use-agents";

// The dialog's state and the actions that drive it.
export interface NewCardDialogLogic {
  cwd: string;
  setCwd: (folder: string) => void;
  backend: Backend;
  setBackend: (b: Backend) => void;
  model: string;
  setModel: (m: string) => void;
  effort: Effort | "";
  setEffort: (e: Effort | "") => void;
  permissionMode: PermissionMode;
  setPermissionMode: (m: PermissionMode) => void;
  error: string | null;
  busy: false | "start" | "backlog";
  started: string | null;
  draftInitial: string;
  saveDraft: (markdown: string) => void;
  // The CLI with its own default model: the model picker's "<CLI> default" row.
  pickCliDefault: (b: Backend) => void;
  pickMode: (m: PermissionMode) => void;
  chooseFolder: (folder: string) => void;
  promptToStart: (read: () => string, focus: () => void) => string | null;
  isolated: boolean;
  setIsolated: (on: boolean) => void;
  toggleIsolated: () => void;
  // The branch its worktree works on ("" for its own weft/* one); picking one turns isolation on.
  branch: string;
  pickBranch: (name: string) => void;
  // Who the thread is (lib/agents.ts): the folder's default (Settings → Agents) until you pick one, Builder when it has none.
  agent: ThreadAgent;
  setAgent: (a: ThreadAgent) => void;
  promptLength: number;
  submit: (
    start: boolean,
    opts: { stay: boolean; read: () => string; clear: () => void; focus: () => void; onCreate: (input: NewCardInput, opts?: { stay?: boolean }) => Promise<void>; onClose: () => void },
  ) => Promise<void>;
}

// Resolves the initial cwd: the defaultCwd (the project's own), then the last cwd if it isn't home,
// then the recent cwd, then the last cwd even if it is home, then home.
function pickInitialCwd(home: string, defaultCwd: string | undefined, recentCwd: string | undefined): string {
  const last = remembered(LAST_CWD);
  return (
    defaultCwd ??
    (last && last !== home ? last : undefined) ??
    recentCwd ??
    last ??
    home
  );
}

// The dialog's effect: load Settings' defaults (defaultBackend, defaultPermissionMode) if the user
// hasn't picked one yet.
function useSettingsDefaults(
  pickedMode: React.RefObject<boolean>,
  pickedBackend: React.RefObject<boolean>,
  setPermissionMode: (m: PermissionMode) => void,
  setBackend: (b: Backend) => void,
  setModel: (m: string) => void,
) {
  useEffect(() => {
    api.settings().then(
      (s) => {
        if (!pickedMode.current) setPermissionMode(s.defaultPermissionMode);
        if (!pickedBackend.current) {
          setBackend(s.defaultBackend);
          setModel(modelFor(s.defaultBackend));
        }
      },
      () => {},
    );
  }, [pickedMode, pickedBackend, setPermissionMode, setBackend, setModel]);
}

// The dialog's state, draft and submit: a single hook so callers don't have to wire the pieces.
export function useNewCardDialog(home: string, defaultCwd: string | undefined, recentCwd: string | undefined): NewCardDialogLogic {
  const [draftInitial] = useState(() => remembered(DRAFT) ?? "");
  const [cwd, setCwd] = useState(() => pickInitialCwd(home, defaultCwd, recentCwd));
  const [backend, setBackend] = useState<Backend>(() => (remembered(LAST_BACKEND) as Backend | null) ?? "claude");
  const pickedBackend = useRef(false);
  const [model, setModelState] = useState(() => modelFor(backend));
  const [effort, setEffortState] = useState<Effort | "">(lastEffort);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("auto");
  const pickedMode = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<false | "start" | "backlog">(false);
  const [started, setStarted] = useState<string | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { isolated, setIsolated, toggleIsolated, branch, pickBranch, promptLength, notePrompt } = useIsolate(cwd);
  // The agent you picked here; a new folder goes back to its own default.
  const [pickedAgent, setAgent] = useState<ThreadAgent | null>(null);
  const { projects: projectAgents } = useAgentList();
  const agent = pickedAgent ?? projectAgents[cwd] ?? "builder";

  useSettingsDefaults(pickedMode, pickedBackend, setPermissionMode, setBackend, setModelState);
  useEffect(() => () => clearTimeout(draftTimer.current), []);

  // A default you changed elsewhere (Settings → Models) lands on an open dialog right away: the
  // model and effort are re-read, and the CLI follows the model when the new model is another
  // CLI's. A model picked in this dialog is not overwritten — the user's own pick wins.
  // The flag lives in a ref, not in state: setModelFor() below announces the pick by calling
  // defaultsChanged() synchronously, and a state flag would still read false in that call, so the
  // dialog would overwrite the model the user had just picked.
  const pickedModel = useRef(false);
  const pickModel = useCallback((m: string) => {
    pickedModel.current = true;
    setModelState(m);
    const resolved = resolveModel(m);
    if (!resolved) return;
    // Remembered as picked, so a Goose row ("goose:<id>") comes back as the same row next time.
    setModelFor(resolved.backend, m);
    setBackend(resolved.backend);
  }, []);

  const setEffort = useCallback((e: Effort | "") => {
    setEffortState(e);
  }, []);

  // The remembered defaults changed somewhere else: re-read them, unless this dialog's own pick
  // is the newer word on the model.
  useEffect(() => subscribeDefaults(() => {
    setEffortState(lastEffort());
    if (pickedModel.current) return;
    const next = modelFor(backend);
    setModelState(next);
    const resolved = resolveModel(next);
    if (resolved && resolved.backend !== backend) setBackend(resolved.backend);
  }), [backend]);

  const saveDraft = useCallback((markdown: string) => {
    notePrompt(markdown);
    setError(null);
    setStarted(null);
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(
      () => remember(DRAFT, markdown.trim() ? markdown : null),
      300,
    );
  }, [notePrompt]);

  const pickCliDefault = useCallback((b: Backend) => {
    pickedBackend.current = true;
    pickedModel.current = true;
    setBackend(b);
    setModelState(NO_MODEL);
  }, []);

  const pickMode = useCallback((m: PermissionMode) => {
    pickedMode.current = true;
    setPermissionMode(m);
  }, []);

  const chooseFolder = useCallback((folder: string) => {
    setCwd(folder);
    setAgent(null);
    setError(null);
    api.warm({ cwd: folder, backend }).catch(() => {}); // best-effort prefetch
  }, [backend]);

  const promptToStart = useCallback((read: () => string, focus: () => void) => {
    let prompt: string;
    try {
      prompt = read();
    } catch (err) {
      setError(errorText(err));
      return null;
    }
    const problem = problemWith(prompt);
    if (!problem) return prompt;
    setError(problem);
    focus();
    return null;
  }, []);

  const submit = useCallback(
    async (
      start: boolean,
      opts: { stay: boolean; read: () => string; clear: () => void; focus: () => void; onCreate: (input: NewCardInput, opts?: { stay?: boolean }) => Promise<void>; onClose: () => void },
    ) => {
      if (busy) return;
      const prompt = promptToStart(opts.read, opts.focus);
      if (prompt === null) return;
      setBusy(start ? "start" : "backlog");
      try {
        const input: NewCardInput = {
          prompt,
          cwd,
          backend,
          permissionMode,
          // A Goose row's value carries a "goose:" prefix to tell it from another CLI's same id; the
          // thread gets the bare id.
          model: bareModel(model),
          effort: effortFor(backend, effort),
          ...(isolated ? { isolated: true, ...(branch ? { branch } : {}) } : {}),
          // Always named, so Builder picked here wins over the folder's default.
          agent,
          start,
        };
        if (opts.stay) await opts.onCreate(input, { stay: true });
        else await opts.onCreate(input);
        clearTimeout(draftTimer.current);
        remember(DRAFT, null);
        rememberPicks({ cwd, backend, model, effort });
        if (!opts.stay) {
          opts.onClose();
          return;
        }
        opts.clear();
        setStarted(headline(prompt));
        setBusy(false);
        opts.focus();
      } catch (err) {
        setError(errorText(err));
        setBusy(false);
      }
    },
    [busy, cwd, backend, permissionMode, model, effort, isolated, branch, agent, promptToStart],
  );

  return {
    cwd,
    setCwd,
    backend,
    setBackend,
    model,
    setModel: pickModel,
    effort,
    setEffort,
    permissionMode,
    setPermissionMode,
    error,
    busy,
    started,
    draftInitial,
    saveDraft,
    pickCliDefault,
    pickMode,
    chooseFolder,
    promptToStart,
    isolated,
    setIsolated,
    toggleIsolated,
    branch,
    pickBranch,
    agent,
    setAgent,
    promptLength,
    submit,
  };
}
