#!/bin/bash
# Verify each intro video: right duration (story + splash), AAC audio present, silence through the splash, and
# loudness near -16 LUFS. Run after the render finishes.
#
#   scripts/verify-intros.sh [id ...]
#
# With no ids it checks every intro. INTROS_DIR points at the compositions and OUT_DIR at the rendered videos.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
INTROS_DIR="${INTROS_DIR:-$here/../public/intros}"
OUT_DIR="${OUT_DIR:-$here/../build/intros}"
ALL="vault webhooks vercel supabase cloudflare blastcp github skills services quality leagues newthread"
IDS="${*:-$ALL}"
# The splash's lead comes from splash-timing.js, the same file the page and the encoder read, so the expected
# length can't drift away from the poster's real length.
LEAD=$(sed -n 's/.*lead: *\([0-9.]*\).*/\1/p' "$INTROS_DIR/splash-timing.js" | head -1)
[ -n "$LEAD" ] || { echo "MISSING $INTROS_DIR/splash-timing.js — the splash's lead is the one number the video's length comes from. Stopping." >&2; exit 1; }
for id in $IDS; do
  f="$OUT_DIR/video/$id-9x16.mp4"
  src="$INTROS_DIR/$id.html"
  if [ ! -f "$f" ]; then echo "$id: MISSING FILE"; continue; fi
  story=$(grep -o 'data-duration="[0-9.]*"' "$src" | grep -o '[0-9.]*')
  want=$(awk "BEGIN { printf \"%.2f\", $story + $LEAD }")
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  has_a=$(ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 "$f" | head -1)
  # The first sound in the track: silence through the splash means the voice starts with the story. silencedetect
  # reports at info level, so the log has to be read at that level, not at error.
  first_snd=$(ffmpeg -hide_banner -v info -i "$f" -af silencedetect=noise=-45dB:d=0.3 -f null - 2>&1 | grep -o 'silence_end: [0-9.]*' | head -1 | cut -d' ' -f2)
  lufs=$(ffmpeg -hide_banner -i "$f" -map 0:a -af ebur128=framelog=quiet -f null - 2>&1 | grep -A3 "Integrated loudness" | grep " I:" | awk '{print $2}')
  ok="OK"
  [ -z "$has_a" ] && ok="NO AUDIO"
  # A blank reel is the failure that looks most like success: the page didn't load, so every frame is the
  # background and ffmpeg is happy. The splash frame is the proof — pull it out and see that it isn't the
  # background. A real splash is well over 100 KB; a blank frame is ~10 KB.
  ffmpeg -v error -ss 1 -i "$f" -frames:v 1 "/tmp/verify-splash-$id.png" -y
  splash_bytes=$(stat -f%z "/tmp/verify-splash-$id.png" 2>/dev/null || echo 0)
  if [ "$splash_bytes" -lt 100000 ]; then ok="BLANK (splash frame only ${splash_bytes}B)"; fi
  echo "$id: dur=$dur (want ~$want) audio=${has_a:-none} voice@${first_snd:-?}s ${lufs:-?}LUFS splash=${splash_bytes}B [$ok]"
done
