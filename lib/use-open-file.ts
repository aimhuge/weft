// One open file in the editor column: read it, watch it on disk for the thread's edits, save it
// back with a base hash so a concurrent change can be refused. The dirty state compares the live
// text to the last cleanly-read text; the disk state tracks mtime+size. While the tab is clean
// (i.e. the user hasn't edited it), a stat poll every two seconds picks up the thread's changes
// and reloads the file in place. While the user is editing, a stat change surfaces as a conflict
// banner with the disk's text and the choice to keep theirs or reload from disk.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileConflictError, type OpenedFile } from "./client-files";
import { useFilesSource } from "./files-source";
import { useFileWatch } from "./use-file-watch";

// Hash of the loaded text; "" means "the file was empty", null means "the file didn't exist".
// useOpenFile takes it as a string for comparisons and to pass to filesApi.write.
function textHash(text: string): string {
  // A tiny FNV-1a — same shape across browsers, no crypto for hot-path text. Good enough to
  // decide "the user changed it". Saves use sha1 from the server.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

const POLL_MS = 2000;

// What filesApi.write returns; turned into an OpenedFile below.
interface WriteResult {
  hash?: string;
  mtime?: number;
}

export interface UseOpenFileResult {
  // null while loading or before the first read; otherwise the file as it was last loaded.
  loaded: OpenedFile | null;
  // The user's working copy. Equal to loaded.text when clean.
  text: string;
  // The text we'd write back; "" if the file didn't exist (we'd create it). Equal to loaded.text
  // when clean, but written through text edits the moment the user touches it.
  savedText: string;
  // True when text !== savedText.
  dirty: boolean;
  // True while loading or saving.
  busy: boolean;
  // The most recent error message, if any.
  error: string | null;
  // The disk's version of the file when the user has unsaved edits and the file changed under
  // them. Cleared when the user resolves it (reload or overwrite) or when the user saves.
  conflict: { disk: OpenedFile; baseHash: string } | null;
  setText: (text: string) => void;
  save: () => Promise<void>;
  // Replace the working text with what's on disk and clear the conflict.
  reload: () => Promise<void>;
  // Save the user's text anyway, dropping the conflict.
  overwrite: () => Promise<void>;
  // Re-read the file from disk (and clear conflict). Use when the user navigates back to a tab
  // and the world has moved on.
  refresh: () => Promise<void>;
  // Write a specific text (e.g. the markdown editor's merged save) and adopt it as the new
  // baseline. Uses the current loaded hash as baseHash unless conflict is set.
  writeWithText: (text: string) => Promise<void>;
}

function makeFile(path: string, text: string, result: WriteResult): OpenedFile {
  return { path, exists: true, text, hash: result.hash ?? null, mtime: result.mtime ?? null, size: text.length };
}

// Adopt a freshly read file as the new baseline: both refs and state.
function adoptRead(
  file: OpenedFile,
  refs: { loaded: OpenedFile | null; text: string; savedText: string },
  set: {
    setLoaded: (f: OpenedFile) => void;
    setText: (t: string) => void;
    setSavedText: (t: string) => void;
  },
): void {
  refs.loaded = file;
  refs.text = file.text;
  refs.savedText = file.text;
  set.setLoaded(file);
  set.setText(file.text);
  set.setSavedText(file.text);
}

// Adopt a freshly written file as the new baseline. The just-written text becomes both the user's
// text (so the editor sees the merged/saved content) and the saved baseline (so dirty clears).
function adoptWrite(
  path: string,
  text: string,
  result: WriteResult,
  refs: { loaded: OpenedFile | null; text: string; savedText: string },
  set: {
    setLoaded: (f: OpenedFile) => void;
    setText: (t: string) => void;
    setSavedText: (t: string) => void;
  },
): void {
  const next = makeFile(path, text, result);
  refs.loaded = next;
  refs.text = text;
  refs.savedText = text;
  set.setLoaded(next);
  set.setText(text);
  set.setSavedText(text);
}

export function useOpenFile(cardId: string, path: string, enabled: boolean): UseOpenFileResult {
  // This Mac's card routes, or a worker's file verbs (lib/files-source.ts).
  const filesApi = useFilesSource();
  const [loaded, setLoaded] = useState<OpenedFile | null>(null);
  const [text, setTextState] = useState("");
  const [savedText, setSavedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<UseOpenFileResult["conflict"]>(null);
  // Refs for values the poll effect reads but doesn't drive; setting state would re-fire the
  // effect and pin a busy loop.
  const loadedRef = useRef<OpenedFile | null>(null);
  const textRef = useRef("");
  const savedTextRef = useRef("");
  // Cancellation flag for the poll. A ref so the tick closure always sees the freshest value
  // without the lint flagging a closure-captured `let` variable as always-falsy.
  const pollCancelledRef = useRef(false);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  useEffect(() => {
    savedTextRef.current = savedText;
  }, [savedText]);

  const dirty = text !== savedText;

  const setText = useCallback((next: string) => {
    setTextState(next);
  }, []);

  // Load on mount, on path change, and on explicit refresh(). The setStates happen inside the
  // .then / .catch chain so the effect that calls load() doesn't synchronously set state. The
  // file is briefly in a "not busy" state while the read is in flight; the test suite only
  // asserts on the settled values (loaded, text, error).
  const load = useCallback(() => {
    return filesApi.read(cardId, path).then(
      (file) => {
        adoptRead(file, { loaded: loadedRef.current, text: textRef.current, savedText: savedTextRef.current }, { setLoaded, setText: setTextState, setSavedText });
        setError(null);
        setConflict(null);
        setBusy(false);
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      },
    );
  }, [cardId, path, filesApi]);

  useEffect(() => {
    if (!enabled) return undefined;
    const promise = load();
    return () => {
      void promise;
    };
  }, [enabled, load]);

  // The file changed on disk: a clean tab takes it; unsaved edits stay, with the disk's text in the conflict banner.
  const onDisk = useCallback((next: OpenedFile) => {
    if (textRef.current === savedTextRef.current) {
      adoptRead(next, { loaded: loadedRef.current, text: textRef.current, savedText: savedTextRef.current }, { setLoaded, setText: setTextState, setSavedText });
      setConflict(null);
    } else {
      setConflict({ disk: next, baseHash: next.hash ?? "" });
    }
  }, []);

  // The poll runs while the tab is mounted, visible, and clean. The setStates happen inside the
  // .then chain, so the effect body itself doesn't synchronously set state.
  useEffect(() => {
    // A source that can't afford the poll (a worker's) reloads only when the file is opened again.
    if (!enabled || filesApi.live === false) return undefined;
    pollCancelledRef.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function schedule(): void {
      timer = setTimeout(tick, POLL_MS);
    }
    function tick(): void {
      if (pollCancelledRef.current) return;
      if (document.hidden) {
        schedule();
        return;
      }
      const cur = loadedRef.current;
      if (!cur) {
        schedule();
        return;
      }
      filesApi
        .stat(cardId, path)
        .then((stat) => {
          if (pollCancelledRef.current) return;
          const changed = (stat.mtime ?? -1) !== (cur.mtime ?? -1) || stat.size !== cur.size;
          if (!changed) return;
          return filesApi.read(cardId, path).then((next) => {
            if (!pollCancelledRef.current) onDisk(next);
          });
        })
        .catch(() => {
          // Polling errors are best-effort; the next tick will retry.
        })
        .finally(() => {
          if (!pollCancelledRef.current) schedule();
        });
    }
    timer = setTimeout(tick, POLL_MS);
    return () => {
      pollCancelledRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [cardId, path, enabled, filesApi, onDisk]);

  // A source that pushes changes instead (a worker's, over its session line) reloads by the same rule.
  useFileWatch(filesApi, cardId, path, enabled, loadedRef, onDisk);

  // Save the user's text back to disk and adopt the response as the new baseline.
  const writeAndAdopt = useCallback(
    async (textToWrite: string, baseHash: string | undefined): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        const result = await filesApi.write(cardId, path, textToWrite, baseHash);
        adoptWrite(
          path,
          textToWrite,
          result,
          { loaded: loadedRef.current, text: textRef.current, savedText: savedTextRef.current },
          { setLoaded, setText: setTextState, setSavedText },
        );
        setConflict(null);
      } catch (err) {
        if (err instanceof FileConflictError) {
          setConflict({ disk: err.current, baseHash: err.current.hash ?? "" });
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setBusy(false);
      }
    },
    [cardId, path, filesApi],
  );

  const save = useCallback(async () => {
    const cur = loadedRef.current;
    const baseHash = cur ? cur.hash ?? undefined : undefined;
    await writeAndAdopt(text, baseHash);
  }, [text, writeAndAdopt]);

  const reload = useCallback((): Promise<void> => {
    if (!conflict) return Promise.resolve();
    adoptRead(conflict.disk, { loaded: loadedRef.current, text: textRef.current, savedText: savedTextRef.current }, { setLoaded, setText: setTextState, setSavedText });
    setConflict(null);
    return Promise.resolve();
  }, [conflict]);

  const overwrite = useCallback(async () => {
    if (!conflict) return;
    // Use a non-tracked baseHash; the user has decided to clobber.
    await writeAndAdopt(text, undefined);
  }, [text, conflict, writeAndAdopt]);

  const writeWithText = useCallback(
    async (textToWrite: string) => {
      const cur = loadedRef.current;
      const baseHash = cur ? cur.hash ?? undefined : undefined;
      await writeAndAdopt(textToWrite, baseHash);
    },
    [writeAndAdopt],
  );

  const refresh = useCallback(async () => {
    if (!enabled) return;
    await load();
  }, [enabled, load]);

  return {
    loaded,
    text,
    savedText,
    dirty,
    busy,
    error,
    conflict,
    setText,
    save,
    reload,
    overwrite,
    refresh,
    writeWithText,
  };
}

// Used by the markdown editor to fingerprint the round-tripped baseline so the saving hook can
// take only the user's edits through preserveFormatting.
export function snapshotHash(text: string): string {
  return textHash(text);
}
