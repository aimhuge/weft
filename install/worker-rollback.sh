#!/bin/sh
# Takes a Weft Worker back to the commit it updated from, when the new one keeps dying at start
# (lib/worker-update.ts, docs/architecture/weft-worker.md#auto-updates). The wrapper runs this before every start, from
# a copy in the worker's home, because a bad commit can't be trusted to undo itself.
#
#   sh rollback.sh <worker home> <clone>
#
# update-trial holds the commit it came from and the one on trial, one a line. The daemon deletes it once it's healthy.
set -u

HOME_DIR="$1"
APP_DIR="$2"
MAX_STARTS="${WEFT_WORKER_MAX_STARTS:-3}"
TRIAL="$HOME_DIR/update-trial"
STARTS="$TRIAL.starts"

[ -f "$TRIAL" ] || exit 0
echo start >> "$STARTS"
[ "$(wc -l < "$STARTS")" -gt "$MAX_STARTS" ] || exit 0

FROM="$(sed -n 1p "$TRIAL")"
BAD="$(sed -n 2p "$TRIAL")"
echo "Weft Worker: $BAD died at start $MAX_STARTS times; going back to $FROM"
if ! git -C "$APP_DIR" reset --hard "$FROM"; then
  echo "Weft Worker: couldn't go back to $FROM" >&2
  exit 0
fi
(cd "$APP_DIR" && pnpm install --frozen-lockfile --config.confirmModulesPurge=false) || echo "Weft Worker: pnpm install failed after going back" >&2
echo "$BAD it died at start." >> "$HOME_DIR/update-bad"
rm -f "$TRIAL" "$STARTS"
