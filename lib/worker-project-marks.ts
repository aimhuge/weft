// Pin to Bar and Hide from Bar on a worker project (its right-click menu, lib/worker-project.ts workerProjectMenu). A
// local project keeps its marks in this Mac's settings (lib/settings.ts markProject), but that list is read by code
// that treats each entry as a folder here (spares, repos, sync), so a worker:// path stays out of it: these marks are
// this board's own, kept in localStorage.
const KEY = "weft-worker-project-marks";
const EVENT = "weft-worker-project-marks";

export type WorkerMarks = { pinned?: boolean; hidden?: boolean };

// The marks as a string, so useSyncExternalStore gets the same snapshot until they change. Browser only: the server
// snapshot is "{}".
export function workerMarksSnapshot(): string {
  return localStorage.getItem(KEY) ?? "{}";
}

export function readWorkerMarks(snapshot: string): Record<string, WorkerMarks> {
  try {
    const parsed: unknown = JSON.parse(snapshot);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, WorkerMarks>) : {};
  } catch {
    return {};
  }
}

// Only the marks given change; one turned off is dropped, and a project with none left leaves the list.
export function setWorkerMarks(path: string, marks: WorkerMarks): void {
  const all = readWorkerMarks(workerMarksSnapshot());
  const merged = { ...all[path], ...marks };
  const next: WorkerMarks = { ...(merged.pinned ? { pinned: true } : {}), ...(merged.hidden ? { hidden: true } : {}) };
  const rest = Object.fromEntries(Object.entries(all).filter(([p]) => p !== path));
  localStorage.setItem(KEY, JSON.stringify(Object.keys(next).length ? { ...rest, [path]: next } : rest));
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeWorkerMarks(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}
