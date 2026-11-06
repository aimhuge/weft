// Feature flags: parts of Weft that stay in the code but are unhooked from the app unless switched on.
// Each one is an env var read when the server starts (next.config.ts bakes it in as NEXT_PUBLIC_*), and
// Electron main reads the same var, so one `WEFT_COPILOT=1 pnpm desktop` turns a feature on everywhere.

// The copilot: its launcher, peek and chat over the board, the top bar's ✨ button, the `c` key and palette
// command, and Electron's copilot window, menu items and ⌃⌥Space. Off by default (docs/architecture/MAP.md, the copilot entry).
export function copilotEnabled(env: string | undefined = process.env.NEXT_PUBLIC_WEFT_COPILOT): boolean {
  return env === "1";
}
