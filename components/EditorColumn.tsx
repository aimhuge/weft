"use client";

import { Suspense, lazy, useCallback, useEffect } from "react";
import Icon from "./Icon";
import { isMarkdownPath, type EditorTab } from "@/lib/editor-tabs";
import { useOpenFile } from "@/lib/use-open-file";
import { preserveFormatting } from "@/lib/markdown-preserve";
import { useEditorColumn } from "@/lib/use-editor-column";
import { ConflictBanner, DiffEmptyView, EmptyHint, SourceView, TabPill } from "./EditorColumnPills";

// The heavy editors live in their own modules so they don't bloat the board bundle. The diff
// against HEAD is code-only; markdown gets WYSIWYG and Source.
const CodeEditor = lazy(() => import("./CodeEditor"));
const DiffEditor = lazy(() => import("./DiffEditor"));
const MarkdownEditor = lazy(() => import("./MarkdownEditor"));
const QuickOpen = lazy(() => import("./QuickOpen"));

export default function EditorColumn({ cardId, cwd, onClose }: { cardId: string; cwd: string; onClose: () => void }) {
  const {
    tabs,
    activeTab,
    setActive,
    close,
    setMode,
    openQuick,
    showQuickOpen,
    hideQuickOpen,
    onKeyDown,
    applyRequest,
    head,
    headLoading,
    headLoaded,
    mdBaselineRef,
    onMdChange,
  } = useEditorColumn(cardId, cwd);

  // ⌘P and ⌘W when focus is anywhere in the column.
  useEffect(() => {
    function handler(e: KeyboardEvent): void {
      onKeyDown(e);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onKeyDown]);

  // The file hook drives save / conflict / live-reload for the active tab.
  const file = useOpenFile(cardId, activeTab?.path ?? "", Boolean(activeTab));

  // Markdown save: merge only the user's edits through preserveFormatting.
  async function onMdSave(): Promise<void> {
    const original = file.loaded?.text ?? "";
    const baseline = mdBaselineRef.current || original;
    const merged = preserveFormatting(original, baseline, file.text);
    if (merged === original && !file.dirty) return;
    await file.writeWithText(merged);
  }

  const onCodeSave = useCallback(() => {
    void file.save();
  }, [file]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-panel" data-editor-column data-card-id={cardId}>
      <ColumnHeader
        tabs={tabs}
        activePath={activeTab?.path ?? null}
        dirty={file.dirty}
        onSelect={setActive}
        onClose={close}
        onMode={setMode}
        onShowQuickOpen={showQuickOpen}
        onCloseColumn={onClose}
      />

      {file.conflict && (
        <ConflictBanner
          diskPath={file.conflict.disk.path}
          onReload={() => void file.reload()}
          onOverwrite={() => void file.overwrite()}
        />
      )}

      <EditorBody
        activeTab={activeTab}
        file={file}
        head={head}
        headLoading={headLoading}
        headLoaded={headLoaded}
        onMdChange={(md) => {
          onMdChange(md);
          file.setText(md);
        }}
        onMdSave={onMdSave}
        onCodeSave={onCodeSave}
      />

      {openQuick && (
        <Suspense fallback={null}>
          <QuickOpen
            cardId={cardId}
            onPick={(path) => applyRequest({ cardId, path })}
            onClose={hideQuickOpen}
          />
        </Suspense>
      )}
    </div>
  );
}

// The pill for one tab (file name, mode, close button). Lives here so the column JSX stays under
// the 300-line cap; the other column pills are in EditorColumnPills.
function ColumnHeader({
  tabs,
  activePath,
  dirty,
  onSelect,
  onClose,
  onMode,
  onShowQuickOpen,
  onCloseColumn,
}: {
  tabs: EditorTab[];
  activePath: string | null;
  dirty: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onMode: (path: string, mode: "edit" | "changes" | "source") => void;
  onShowQuickOpen: () => void;
  onCloseColumn: () => void;
}) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-line bg-panel px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <TabPill
            key={tab.path}
            tab={tab}
            active={activePath === tab.path}
            dirty={activePath === tab.path && dirty}
            onClick={() => onSelect(tab.path)}
            onClose={() => onClose(tab.path)}
            onMode={(mode) => onMode(tab.path, mode)}
          />
        ))}
        <button
          type="button"
          onClick={onShowQuickOpen}
          className="ml-1 inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] text-muted hover:bg-sunken hover:text-ink"
          title="Open file (⌘P)"
        >
          <Icon name="search" size={12} />
          <span>Search</span>
        </button>
      </div>
      <button
        type="button"
        onClick={onCloseColumn}
        aria-label="Close editor column"
        className="ml-2 shrink-0 rounded p-1 text-muted hover:bg-sunken hover:text-ink"
      >
        <Icon name="x" size={14} />
      </button>
    </header>
  );
}

// The body that picks which editor to show for the active tab. Pulled out to keep the column's
// main function under the complexity cap.
function EditorBody({
  activeTab,
  file,
  head,
  headLoading,
  headLoaded,
  onMdChange,
  onMdSave,
  onCodeSave,
}: {
  activeTab: EditorTab | null;
  file: ReturnType<typeof useOpenFile>;
  head: string | null | undefined;
  headLoading: boolean;
  headLoaded: boolean;
  onMdChange: (md: string) => void;
  onMdSave: () => Promise<void>;
  onCodeSave: () => void;
}) {
  return (
    <div className="relative min-h-0 flex-1">
      {!activeTab && <EmptyHint />}
      {activeTab && file.loaded === null && !file.error && (
        <div className="flex h-full items-center justify-center text-[13px] text-faint">Loading {activeTab.path}…</div>
      )}
      {activeTab && file.loaded && (
        <Suspense fallback={<div className="flex h-full items-center justify-center text-[13px] text-faint">Loading editor…</div>}>
          <ActiveEditor
            activeTab={activeTab}
            file={file}
            head={head}
            headLoading={headLoading}
            headLoaded={headLoaded}
            onMdChange={onMdChange}
            onMdSave={onMdSave}
            onCodeSave={onCodeSave}
          />
        </Suspense>
      )}
      {file.error && (
        <div className="absolute bottom-2 left-2 right-2 rounded border border-line bg-danger-soft px-2 py-1 text-[12px] text-danger">
          {file.error}
        </div>
      )}
    </div>
  );
}

// The right editor for the active tab's path and mode.
function ActiveEditor({
  activeTab,
  file,
  head,
  headLoading,
  headLoaded,
  onMdChange,
  onMdSave,
  onCodeSave,
}: {
  activeTab: EditorTab;
  file: ReturnType<typeof useOpenFile>;
  head: string | null | undefined;
  headLoading: boolean;
  headLoaded: boolean;
  onMdChange: (md: string) => void;
  onMdSave: () => Promise<void>;
  onCodeSave: () => void;
}) {
  if (isMarkdownPath(activeTab.path)) {
    return activeTab.mode === "edit" ? (
      <MarkdownEditor
        path={activeTab.path}
        text={file.text}
        baseline={file.loaded?.text ?? ""}
        onChange={onMdChange}
        onSave={() => void onMdSave()}
      />
    ) : (
      <SourceView text={file.text} onChange={file.setText} onSave={() => void onMdSave()} />
    );
  }
  if (activeTab.mode === "edit") {
    return <CodeEditor path={activeTab.path} text={file.text} onChange={file.setText} onSave={onCodeSave} line={activeTab.line} />;
  }
  if (headLoading) {
    return <DiffEmptyView state="loading" />;
  }
  if (headLoaded) {
    return <DiffEditor path={activeTab.path} text={file.text} headText={head as string | null} onChange={file.setText} onSave={onCodeSave} />;
  }
  return <DiffEmptyView state="no-changes" />;
}