"use client";

// Where the editor column's files come from (docs/architecture/project-hosts.md, H4): this Mac's card routes
// (lib/client-files.ts) by default, a Weft Worker's file verbs for a worker card (lib/worker-files.ts). OpenCard provides
// the open card's host's source, so the editor, ⌘P and the diff read the same way wherever the card runs.
import { createContext, useContext } from "react";
import { filesApi } from "./client-files";

// Watches one open file and calls back with its hash when it changes (null once it's gone); returns the stop.
export type FileWatch = (cardId: string, path: string, changed: (hash: string | null) => void) => () => void;

// `live` false: the source can't afford a stat poll, so an open file doesn't reload on its own, unless the source can
// `watch` it, which pushes changes instead (a worker's, over its session line: lib/line-file-watch.ts).
export type FilesSource = typeof filesApi & { live?: boolean; watch?: FileWatch };

export const FilesSourceContext = createContext<FilesSource>(filesApi);

export const useFilesSource = () => useContext(FilesSourceContext);
