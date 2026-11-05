// Display helpers with no app types behind them, shared by the board, weft.zip and the phone (lib/format.ts
// re-exports them for the app's own code).

export function shortToolName(name: string) {
  return name.startsWith("mcp__") ? name.split("__").slice(1).join(" ") : name;
}

export function timeAgo(at: number, now: number) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Cuts text to at most `max` characters, ending in an ellipsis when it had to cut — the ellipsis is
// counted, which is why the slice is `max - 1`. This is the one clip: electron/menus.cjs holds a CJS twin
// main can't avoid, and lib/search.ts deliberately cuts without an ellipsis (it indexes the text).
export function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
