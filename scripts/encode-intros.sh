#!/bin/bash
# Encode captured intro frames into an mp4, muxing the narration when public/intros/<id>.m4a exists, and
# loudness-normalising it to -16 LUFS (the narrated mix sits near -24 dB, too quiet to hear).
# Both inputs carry an explicit -f: ffmpeg 8 misreads a codec flag sitting between two inputs as a third input.
# The narration is delayed by the splash (LEAD) so the voice starts with the story, not under the splash.
#
#   scripts/encode-intros.sh <id> <fps> [portrait]
#
# The frames and the finished video live under build/intros by default; OUT_DIR moves them, and INTROS_DIR
# points at the compositions when they live somewhere else (a Mac mini with the sources synced, not the repo).
set -euo pipefail
id="$1"; fps="$2"; portrait="${3:-}"
here="$(cd "$(dirname "$0")" && pwd)"
out="${OUT_DIR:-$here/../build/intros}"
frames="$out/frames/$id-$fps${portrait:+-p}"
mkdir -p "$out/video"

LEAD=2.0
# adelay takes milliseconds, as an integer.
LEAD_MS=$(awk "BEGIN { printf \"%d\", $LEAD * 1000 }")
# The narration lives beside the compositions: INTROS_DIR points at that folder, so the same script renders
# on a laptop and on a Mac mini that has the sources synced but not the whole repo.
INTROS_DIR="${INTROS_DIR:-$here/../public/intros}"
args=(-y -loglevel error -f image2 -framerate "$fps" -i "$frames/f%04d.png")
if [ -f "$INTROS_DIR/$id.m4a" ]; then
  # The m4a suffix hides an mp4 container, so the format is stated before the decode.
  ffmpeg -y -loglevel error -f mp4 -i "$INTROS_DIR/$id.m4a" "$out/frames/$id.wav"
  # adelay puts the voice in after the splash; the loudness pass runs on the delayed track.
  args+=(-f wav -i "$out/frames/$id.wav" -af "adelay=${LEAD_MS}|${LEAD_MS},loudnorm=I=-16:TP=-1.5:LRA=11")
  args+=(-c:a aac -b:a 128k -shortest)
fi
args+=(-c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart)

suffix=""; [ -n "$portrait" ] && suffix="-9x16"
ffmpeg "${args[@]}" "$out/video/$id$suffix.mp4"
echo "$out/video/$id$suffix.mp4"
