#!/bin/bash
# tests.sh — run the tests that cover the session
# Usage: tests.sh file ...     With vitest, runs only the tests related to the
#                              files (vitest related). With no files it runs
#                              nothing: a whole-suite sweep skips the project's
#                              memory guards and is never a wrap-up's job.
#
# Prefers the project's own vitest binary: `pnpm test` in a pnpm@11 repo can
# try to purge and reinstall node_modules under a running dev server.

FILES=()
for f in "$@"; do [ -f "$f" ] && FILES+=("$f"); done

if [ ${#FILES[@]} -eq 0 ]; then
  echo "=== No session files: tests skipped ==="
  exit 0
fi

echo "=== Running Tests ==="
if [ -x node_modules/.bin/vitest ]; then
  node_modules/.bin/vitest related --run "${FILES[@]}" 2>&1
  EXIT_CODE=$?
else
  pnpm test 2>&1
  EXIT_CODE=$?
fi

echo ""
echo "=== Test Exit Code: $EXIT_CODE ==="
exit $EXIT_CODE
