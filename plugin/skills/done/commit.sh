#!/bin/bash
# commit.sh — Phase 5: stage and commit
# Usage: commit.sh "commit message" [file1 file2 ...]
# First argument is the commit message, remaining are files to stage
#
# The commit takes ONLY these paths (`git commit -- <paths>`), never the whole
# index. Sessions that share a working tree share its index, so a bare
# `git commit` would also take whatever another session staged a second ago.
# `git add` still runs first: a pathspec commit can't see a brand-new file
# until it is tracked. A tracked path that is gone from disk is committed as
# a deletion; a path git has never seen fails the whole commit.
#
# In a Weft thread a shared doc may have lines another card is still writing.
# Weft leaves a note in .git/weft-held (lib/commit-held.ts) naming the blob to
# commit in their place; those paths commit through a temp index and the other
# card's lines stay in the working tree. A note whose HEAD or working file has
# moved on is ignored, and the path commits whole.

if [ $# -lt 1 ]; then
  echo "Usage: commit.sh \"commit message\" [file1 file2 ...]"
  exit 1
fi

MESSAGE="$1"
shift

# The blob a path's note says to commit, if the note still holds.
held_blob() {
  local key note base work blob
  key=$(printf '%s' "$PREFIX$1" | git hash-object --stdin)
  note="$NOTES/$key"
  [ -f "$note" ] || return 1
  { read -r base; read -r work; read -r blob; } < "$note"
  rm -f "$note"
  [ "$base" = "$(git rev-parse HEAD)" ] && [ -e "$1" ] && [ "$work" = "$(git hash-object -- "$1")" ] || return 1
  echo "$blob"
}

NOTES="$(git rev-parse --absolute-git-dir 2>/dev/null)/weft-held"
PREFIX="$(git rev-parse --show-prefix 2>/dev/null)"
if [ -d "$NOTES" ] && [ $# -gt 0 ]; then
  TEMP_INDEX=$(mktemp -t weft-index)
  rm -f "$TEMP_INDEX"
  GIT_INDEX_FILE="$TEMP_INDEX" git read-tree HEAD
  HELD=0
  for f in "$@"; do
    if blob=$(held_blob "$f"); then
      GIT_INDEX_FILE="$TEMP_INDEX" git update-index --add --cacheinfo "100644,$blob,$PREFIX$f"
      echo "  $f: leaving out lines another card is writing"
      HELD=1
    else
      GIT_INDEX_FILE="$TEMP_INDEX" git add -A -- "$f"
    fi
  done
  if [ "$HELD" = 1 ]; then
    echo "=== Committing (only your own lines of shared docs) ==="
    GIT_INDEX_FILE="$TEMP_INDEX" git commit -m "$MESSAGE"
    EXIT_CODE=$?
    rm -f "$TEMP_INDEX"
    # The real index still has these paths as they were: bring them to the new HEAD.
    [ $EXIT_CODE -eq 0 ] && git reset -q -- "$@"
    echo ""
    echo "=== Post-Commit Status ==="
    git status --short
    exit $EXIT_CODE
  fi
  rm -f "$TEMP_INDEX"
fi

echo "=== Staging Files ==="
if [ $# -gt 0 ]; then
  for f in "$@"; do
    if [ -e "$f" ]; then
      git add "$f"
      echo "  staged: $f"
    else
      echo "  not on disk: $f (committed as a deletion if tracked)"
    fi
  done
else
  echo "No files specified to stage"
  exit 1
fi

echo ""
echo "=== Committing (only the paths above) ==="
git commit -m "$MESSAGE" -- "$@"
EXIT_CODE=$?

echo ""
echo "=== Post-Commit Status ==="
git status --short

exit $EXIT_CODE
