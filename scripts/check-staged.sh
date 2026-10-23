#!/bin/bash
# Type-checks and lints exactly what's staged, not the working tree: a commit can't import a file that
# exists on disk but was never added. Runs on a copy of the index, so it never stashes or touches
# other threads' unstaged work in the shared tree. Skip once with `git commit --no-verify`.
set -u
root="$(git rev-parse --show-toplevel)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/weft-staged.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

# A secret in a commit lives in history for good, so scan the staged changes first.
if command -v gitleaks > /dev/null 2>&1; then
  if ! gitleaks git --pre-commit --staged --redact --no-banner --no-color --verbose "$root" > "$tmp/gitleaks.log" 2>&1; then
    echo "pre-commit: gitleaks found what looks like a secret in the staged changes:" >&2
    grep -E "^(RuleID|File|Line):" "$tmp/gitleaks.log" | head -30 >&2
    echo "Move it to .env.local (or Weft's vault). A false alarm? Add a 'gitleaks:allow' comment on that line." >&2
    exit 1
  fi
else
  # Without gitleaks, Weft's own key shapes (lib/secret-detect.ts, the paste guard's) check each added line.
  if ! node --no-warnings "$root/scripts/secret-scan.mjs"; then
    echo "pre-commit: that looks like a secret in the staged changes (shown above, masked)." >&2
    echo "Move it to .env.local (or Weft's vault). A false alarm? Add a 'gitleaks:allow' comment on that line." >&2
    exit 1
  fi
  echo "pre-commit: scanned for secrets with Weft's key patterns; gitleaks catches more (brew install gitleaks)." >&2
fi

# Nothing staged that tsc or eslint reads (a docs-only commit, like the CHANGELOG.md one Weft makes after a card's
# commit, lib/changelog-write.ts): the secret scan was the whole check.
code="$(git -C "$root" diff --cached --name-only -- '*.ts' '*.tsx' '*.mts' '*.cts' '*.js' '*.jsx' '*.cjs' '*.mjs' '*.json')"
[ -z "$code" ] && exit 0

git -C "$root" checkout-index --all --prefix="$tmp/"
ln -s "$root/node_modules" "$tmp/node_modules"
cd "$tmp" || exit 1

# Start from the tree's incremental cache, so tsc re-checks only what changed and what depends on it
# instead of the whole repo cold. It takes turns with every other card's typecheck (one-at-a-time.mjs).
cp "$root/tsconfig.tsbuildinfo" "$tmp/" 2> /dev/null || true
npx --no-install next typegen > /dev/null 2>&1
if ! node "$root/scripts/one-at-a-time.mjs" typecheck npx --no-install tsc --noEmit > "$tmp/tsc.log" 2>&1; then
  echo "pre-commit: the staged files don't type-check on their own:" >&2
  grep "error TS" "$tmp/tsc.log" | head -20 >&2
  echo "Usually a file it imports isn't staged: check 'git status' for untracked files." >&2
  exit 1
fi

# Lint the staged versions of the changed files, with the same rules as `pnpm lint`.
git -C "$root" diff --cached --name-only --diff-filter=ACMR -z -- '*.ts' '*.tsx' '*.mts' '*.cjs' '*.mjs' > "$tmp/.staged"
if [ -s "$tmp/.staged" ]; then
  if ! xargs -0 npx --no-install eslint --max-warnings 0 --no-warn-ignored < "$tmp/.staged" > "$tmp/eslint.log" 2>&1; then
    echo "pre-commit: the staged files don't pass lint:" >&2
    head -40 "$tmp/eslint.log" >&2
    exit 1
  fi
fi
