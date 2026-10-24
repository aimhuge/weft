"use client";

import { useRef } from "react";
import { isMac } from "@/lib/hotkeys";
import { type NewCardInput } from "@/lib/client";
import type { Card, RestartStatus } from "@/lib/types";
import { busyInFolder } from "@/lib/overlap";
import { startButton, modelLabel } from "@/lib/new-thread";
import { gateNote } from "@/lib/limit-reset";
import { useEscape } from "@/lib/use-escape";
import { useFeatureIntro } from "@/lib/use-feature-intro";
import { hasPane, usePaneIntro } from "@/lib/pane-intro";
import { useHeldModifiers } from "@/lib/use-mod-held";
import { useNewCardDialog } from "@/lib/use-new-card-dialog";
import { useStartGate } from "@/lib/use-start-gate";
import { NEW_THREAD } from "@/lib/file-drop";
import Composer, { type ComposerHandle } from "./Composer";
import { IntroButton, IntroFrame, PlayIntroButton } from "./FeatureIntro";
import Icon from "./Icon";
import { NewCardDialogControls } from "./NewCardDialogControls";
import { NewCardDialogFooter } from "./NewCardDialogFooter";
import { RestartRequested } from "./RestartChip";
import StatusStrip from "./StatusStrip";
import { isBacklogKey } from "./submit-keys";
import { track } from "@/lib/analytics";
import { suggestIsolate } from "@/lib/use-isolate";

export default function NewCardDialog({
  cards = [],
  home,
  defaultCwd,
  recentCwd,
  restart,
  onClose,
  onCreate,
}: {
  // The board's cards, to warn when the chosen folder already has busy ones (lib/overlap.ts).
  cards?: Card[];
  home: string;
  // The selected project, if any; otherwise the last folder used.
  defaultCwd?: string;
  // Folder of the most recently active card outside home, used when nothing better is remembered.
  recentCwd?: string;
  // An armed restart (lib/restart-when-idle.ts): a thread started now waits for it, so the header says so.
  restart?: RestartStatus | null;
  onClose: () => void;
  // stay: started with ⌃↵, so the dialog stays open for the next thread.
  onCreate: (input: NewCardInput, opts?: { stay?: boolean }) => Promise<void>;
}) {
  const dialog = useNewCardDialog(home, defaultCwd, recentCwd);
  // ⌘ or ⌃ held: the Start button names what ⌘↵ or ⌃↵ will do.
  const startBtn = startButton(useHeldModifiers());
  // A busy card in this folder shares its working tree, unless this one is isolated (docs/architecture/worktrees.md).
  const alsoHere = busyInFolder(cards, dialog.cwd);
  // When this model or CLI is at its limit, the thread can't start now: the Start button names the
  // reset it waits for, and the card runs then (lib/start-gate.ts).
  const gate = useStartGate(dialog.backend, dialog.model);
  const composer = useRef<ComposerHandle>(null);
  useEscape(true, onClose);
  // Its intro plays the first time the dialog opens (lib/feature-intros.ts), in the browser pane on the desktop
  // (lib/pane-intro.ts) and in a frame over the composer on the web; ▶ by the title plays it again.
  const inPane = hasPane();
  const intro = useFeatureIntro(inPane ? null : "newthread");
  const playInPane = usePaneIntro(inPane ? "newthread" : null);

  // The composer-backed submit: each call site picks its `start` and `stay` shape.
  const composerOps = {
    read: () => composer.current?.read() ?? "",
    clear: () => composer.current?.clear(),
    focus: () => composer.current?.focus(),
  };
  const submit = (start: boolean, stay: boolean) =>
    dialog.submit(start, {
      stay,
      ...composerOps,
      onCreate: async (input, options) => {
        if (options) await onCreate(input, options);
        else await onCreate(input);
        if (input.start) track("thread_started", {
          backend: input.backend,
          model: input.model || "default",
          effort: input.effort || "default",
        });
      },
      onClose,
    });

  return (
    <aside
      // Capture, so ⌘B adds to the Backlog before the composer reads it as bold.
      onKeyDownCapture={(e) => {
        if (!isBacklogKey(e, isMac())) return;
        e.preventDefault();
        e.stopPropagation();
        if (!dialog.busy) void submit(false, false);
      }}
      className="flex w-[44%] min-w-[380px] shrink-0 flex-col bg-panel last:flex-1"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="flex min-w-0 items-center gap-2 truncate text-[15px] font-medium text-ink">
          New thread
          {playInPane ? <PlayIntroButton id="newthread" onPlay={playInPane} /> : <IntroButton intro={intro} />}
          <RestartRequested restart={restart} />
        </h2>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-5 pt-3">
        <IntroFrame intro={intro} className="mb-3" />
        <Composer
          ref={composer}
          variant="dialog"
          cwd={dialog.cwd}
          dropTarget={NEW_THREAD}
          autoFocus
          initial={dialog.draftInitial}
          onChange={dialog.saveDraft}
          onSubmit={() => void submit(true, false)}
          onSubmitAlt={() => void submit(true, true)}
          placeholder="What should this thread do? Paste screenshots or videos right where they belong, or hit the mic and talk."
          sizeClass="h-full min-h-[180px]"
          className="flex-1"
        />
      </div>

      <NewCardDialogControls
        cwd={dialog.cwd}
        home={home}
        backend={dialog.backend}
        model={dialog.model}
        effort={dialog.effort}
        permissionMode={dialog.permissionMode}
        onChooseFolder={dialog.chooseFolder}
        onPickModel={dialog.setModel}
        onPickEffort={dialog.setEffort}
        onPickMode={dialog.pickMode}
        isolate={{ on: dialog.isolated, suggest: suggestIsolate(alsoHere.length, dialog.promptLength), onToggle: dialog.toggleIsolated }}
      />

      <NewCardDialogFooter
        backend={dialog.backend}
        onPickBackend={dialog.pickBackend}
        error={dialog.error}
        alsoHere={dialog.isolated ? [] : alsoHere}
        started={dialog.started}
        busy={dialog.busy}
        startBtn={startBtn}
        waitsUntil={gate?.at}
        waitsFor={gate ? gateNote(gate, modelLabel(dialog.model)) : undefined}
        onSubmit={(start) => void submit(start, false)}
      />
      {/* The board's footer sits under this dialog, so its folder and plan limits show here instead. */}
      <StatusStrip cwd={dialog.cwd} backend={dialog.backend}
        className="shrink-0 border-t border-line px-5 py-1.5" />
    </aside>
  );
}
