"use client";

import { useUiText } from "@/lib/ui-language";
import { useRef, useState } from "react";
import { isMac } from "@/lib/hotkeys";
import { type NewCardInput } from "@/lib/client";
import type { Card, RestartStatus } from "@/lib/types";
import { busyInFolder } from "@/lib/overlap";
import { startButton, modelLabel } from "@/lib/new-thread";
import { gateNote } from "@/lib/limit-reset";
import { useEscape } from "@/lib/use-escape";
import { useFeatureIntro } from "@/lib/use-feature-intro";
import { hasPane, playPaneIntro } from "@/lib/pane-intro";
import { NEW_THREAD_PANE } from "@/lib/use-new-thread-pane";
import { useHeldModifiers } from "@/lib/use-mod-held";
import { useNewCardDialog } from "@/lib/use-new-card-dialog";
import { useStartGate } from "@/lib/use-start-gate";
import { useOneBox } from "@/lib/use-one-box";
import { NEW_THREAD } from "@/lib/file-drop";
import Composer, { type ComposerHandle } from "./Composer";
import { IntroButton, IntroFrame, PlayIntroButton } from "./FeatureIntro";
import NewThreadHeaderActions from "./NewThreadHeaderActions";
import { DialogControls, NewThreadModelPicker } from "./NewCardDialogControls";
import { NewCardOneBox, OneBoxTitle } from "./NewCardOneBox";
import { composerLook, wantsProjectChips } from "@/lib/one-box";
import { isWorkerProject } from "@/lib/worker-project";
import { DialogStatus, NewCardDialogFooter } from "./NewCardDialogFooter";
import { RestartRequested } from "./RestartChip";
import { isBacklogKey } from "./submit-keys";
import { track } from "@/lib/analytics";
import { canBacklog, useNewCardTransport } from "@/lib/new-card-transport";

export default function NewCardDialog({
  cards = [],
  home,
  defaultCwd,
  recentCwd,
  restart,
  onClose,
  onCreate,
  onManageAgents,
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
  // Opens Settings → Agents, from the Agent menu's "Manage agents…".
  onManageAgents?: () => void;
}) {
  const t = useUiText();
  // The desktop's own server, or weft.zip's places and new_card command (lib/new-card-transport.ts).
  const host = useNewCardTransport();
  const dialog = useNewCardDialog(home, defaultCwd, recentCwd, host.local, host.startMode);
  // ⌘ or ⌃ held: the Start button names what ⌘↵ or ⌃↵ will do.
  const startBtn = startButton(useHeldModifiers());
  // A busy card in this folder shares its working tree, unless this one is isolated (docs/architecture/worktrees.md).
  const alsoHere = busyInFolder(cards, dialog.cwd);
  // When this model or CLI is at its limit, the thread can't start now: the Start button names the
  // reset it waits for, and the card runs then (lib/start-gate.ts).
  const gate = useStartGate(dialog.backend, dialog.model);
  const composer = useRef<ComposerHandle>(null);
  // Simple mode's one-box dialog, laid out like the phone's new-card screen until More (lib/use-one-box.ts).
  const { full, showAll } = useOneBox();
  const look = composerLook(full);
  // The composer starts from the saved draft, and from what was typed when More swaps the one-box one for the full one.
  const [initial, setInitial] = useState(dialog.draftInitial);
  const showMore = () => {
    setInitial(composer.current?.read() ?? "");
    showAll();
  };
  useEscape(true, onClose);
  // Its intro plays when you press ▶ by the title (lib/feature-intros.ts), never on its own: in the browser pane on the
  // desktop beside it (lib/pane-intro.ts) and in a frame over the composer on the web.
  const inPane = hasPane();
  const intro = useFeatureIntro(inPane ? null : "newthread");
  const playInPane = inPane ? () => playPaneIntro("newthread", NEW_THREAD_PANE) : null;

  // The model picker: in the composer's bottom bar, or as a pill over it in the one-box dialog.
  const modelPicker = (pill: boolean) => (
    <NewThreadModelPicker
      cwd={host.local ? dialog.cwd : undefined}
      backend={dialog.backend}
      model={dialog.model}
      onPickModel={dialog.setModel}
      onPickCli={dialog.pickCliDefault}
      pill={pill}
    />
  );

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
      // A thread on a worker gets its start signed for the GitHub connector (lib/worker-folder-repo.ts), so the whole
      // dialog is the user's alone there: board_view can't type its prompt or press Create (electron/board-view.cjs).
      data-human-only={isWorkerProject(dialog.cwd) || undefined}
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
          {t("New thread")}
          <OneBoxTitle shown={!full} cwd={dialog.cwd} places={host.places} />
          {playInPane ? <PlayIntroButton id="newthread" onPlay={playInPane} /> : <IntroButton intro={intro} />}
          <RestartRequested restart={restart} />
        </h2>
        <NewThreadHeaderActions cron={host.local && full} read={composerOps.read} picks={dialog} onCreated={() => { composerOps.clear(); onClose(); }} onClose={onClose} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-5 pt-3">
        <IntroFrame intro={intro} className="mb-3" />
        <NewCardOneBox
          shown={!full}
          chips={wantsProjectChips(host.local, defaultCwd)}
          cwd={dialog.cwd}
          onPick={dialog.chooseFolder}
          host={host}
          model={modelPicker(true)}
          onMore={showMore}
        />
        <Composer
          // More remounts it in the full layout, which sizes it at creation; what was typed carries over.
          key={look.key}
          ref={composer}
          variant="dialog"
          cwd={dialog.cwd}
          dropTarget={NEW_THREAD}
          autoFocus
          initial={initial}
          onChange={dialog.saveDraft}
          onSubmit={() => void submit(true, false)}
          onSubmitAlt={() => void submit(true, true)}
          placeholder={t(look.placeholder)}
          sizeClass={look.sizeClass}
          className={look.className}
          look={look.look}
          modelPicker={full && modelPicker(false)}
        />
      </div>

      <DialogControls shown={full} dialog={dialog} host={host} home={home} busyHere={alsoHere.length} onManageAgents={onManageAgents} />

      <NewCardDialogFooter
        error={dialog.error}
        alsoHere={dialog.isolated ? [] : alsoHere}
        started={dialog.started}
        busy={dialog.busy}
        startBtn={startBtn}
        waitsUntil={gate?.at}
        waitsFor={gate ? gateNote(gate, modelLabel(dialog.model)) : undefined}
        canBacklog={host.local || canBacklog(dialog.cwd)}
        minimal={!full}
        onSubmit={(start) => void submit(start, false)}
      />
      <DialogStatus shown={full} host={host} cwd={dialog.cwd} backend={dialog.backend} />
    </aside>
  );
}
