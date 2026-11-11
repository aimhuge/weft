#!/bin/bash
# settled.sh — first step: is this card already wrapped up?
# Usage: settled.sh [session files...]
#
# Settled means none of the session files has an uncommitted change (staged, unstaged or untracked) and the
# branch has nothing its upstream lacks. A card that committed and pushed its own work before Done is then
# archived with no tests, docs, scout or report (SKILL.md, "First: already done?").
#
# Exit 0: settled, with one line saying so.
# Exit 1: something is left, with the reason; run the full wrap-up.

if [ "$#" -gt 0 ]; then
  DIRTY=$(git status --porcelain --untracked-files=all -- "$@" 2>/dev/null)
  if [ -n "$DIRTY" ]; then
    echo "Not settled: $(printf '%s\n' "$DIRTY" | wc -l | tr -d ' ') session file(s) have uncommitted changes."
    exit 1
  fi
fi

BRANCH=$(git symbolic-ref --quiet --short HEAD)
UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
if [ -n "$BRANCH" ] && [ -n "$UPSTREAM" ]; then
  AHEAD=$(git rev-list --count '@{u}..HEAD')
  if [ "$AHEAD" != "0" ]; then
    echo "Not settled: $BRANCH has $AHEAD commit(s) $UPSTREAM doesn't."
    exit 1
  fi
  echo "Settled: the session files are committed and $BRANCH matches $UPSTREAM."
  exit 0
fi
if [ -n "$BRANCH" ] && git remote get-url origin >/dev/null 2>&1; then
  echo "Not settled: $BRANCH has never been pushed."
  exit 1
fi
echo "Settled: the session files are committed and there's nowhere to push."
