// The shape of a GitHub clone's progress, in a file of types only.
//
// It lives here, not in lib/clone-progress.ts, because the repo picker and the project menu draw the bar
// (lib/use-clone-progress.ts) and lib/client-api.ts names the type — and a client module that names a
// server module's type still makes Turbopack resolve that server module, which spawns git with
// node:child_process. A browser chunk can't hold that, so the whole board failed to compile.

// One overall percent and the line that says it.
export type CloneJob = { status: "running" | "done" | "failed"; line: string; percent: number | null };
