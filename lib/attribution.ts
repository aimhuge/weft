// How a board thread signs its commits and PRs: Claude Code's own lines, plus "on Weft".
// Passed as the CLI's `attribution` setting, so it replaces the default co-author trailer.

// "claude-opus-5-5[1m]" → "Claude Opus 5.5"; anything else (an alias, a puku model) → "Claude".
export function modelName(model: string | undefined): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[.*\])?$/.exec(model ?? "");
  if (!m) return "Claude";
  const [, family, major, minor] = m;
  return `Claude ${String(family).charAt(0).toUpperCase()}${String(family).slice(1)} ${major}${minor ? `.${minor}` : ""}`;
}

export function attribution(model: string | undefined): { commit: string; pr: string } {
  return {
    commit: `Co-Authored-By: ${modelName(model)} on Weft <noreply@anthropic.com>`,
    pr: "🤖 Generated with [Claude Code](https://claude.com/claude-code) on Weft",
  };
}

// Signs a board thread's CLI as Weft once its model is known: at init, and when a spare takes a card's model.
// The copilot doesn't commit, and puku-cli has its own attribution.
export function signAsWeft(
  q: { applyFlagSettings(settings: { attribution: ReturnType<typeof attribution> }): Promise<void> } | undefined,
  spec: { backend: string; copilot?: boolean },
  model: string | undefined,
): void {
  if (spec.backend !== "claude" || spec.copilot) return;
  void q?.applyFlagSettings({ attribution: attribution(model) }).catch(() => {});
}

// A Goose thread's lines. Goose has no attribution setting, so they go in its system text instead
// (lib/goose-recipe.ts gooseSystemText). The model is whatever the provider serves, often not Claude's,
// so the trailer names Goose and the model id as given, at Weft's own address rather than Anthropic's.
export function gooseAttribution(model: string | undefined): { commit: string; pr: string } {
  return {
    commit: `Co-Authored-By: Goose${model ? ` (${model})` : ""} on Weft <noreply@weft.zip>`,
    pr: "🤖 Generated with [Goose](https://github.com/aaif-goose/goose) on Weft",
  };
}

// The instruction a Goose thread gets, worded like the attribution reminder Claude Code gives its own threads.
export function gooseAttributionPrompt(model: string | undefined): string {
  const { commit, pr } = gooseAttribution(model);
  return `# Attribution
For git commits and pull requests you create (including in /weft:done and /weft:commit):
- End git commit messages with:
${commit}
- End pull request descriptions with:
${pr}`;
}
