import { globalSingleton } from "./global-singleton";

// The project-open hook: lib/settings.ts touchProject calls projectOpened when a folder joins the recent
// projects (opened from the project menu, cloned, made new, or the folder of a new card). Anything that
// wants to look at a project once it lands on the board registers here by name (lib/project-seed-run.ts
// seeds its Backlog). touchProject sits on the start-a-card path, so handlers never run inline: each one
// runs on a later tick, and one that throws is logged without stopping the others.

export type ProjectOpenHandler = (folder: string) => void | Promise<void>;

const handlers = globalSingleton("__weftProjectOpen", () => new Map<string, ProjectOpenHandler>());

// Registers (or, by the same name, replaces) a handler, so a dev-mode reload doesn't add a second one.
export function onProjectOpen(name: string, handler: ProjectOpenHandler) {
  handlers.set(name, handler);
}

export function offProjectOpen(name: string) {
  handlers.delete(name);
}

function report(name: string, err: unknown) {
  console.warn(`[weft] project-open ${name} failed:`, err);
}

export function projectOpened(folder: string) {
  for (const [name, handler] of handlers) {
    setImmediate(() => {
      try {
        void Promise.resolve(handler(folder)).catch((err: unknown) => report(name, err));
      } catch (err) {
        report(name, err);
      }
    });
  }
}
