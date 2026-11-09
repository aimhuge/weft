// Feature flags on Electron's side, the same env vars lib/features.ts reads on the board's side:
// one `WEFT_COPILOT=1 pnpm desktop` turns a feature on in both.

// The copilot: off, it has no window, menu items, weft://copilot link or ⌃⌥Space.
exports.COPILOT_ENABLED = process.env.WEFT_COPILOT === "1";
