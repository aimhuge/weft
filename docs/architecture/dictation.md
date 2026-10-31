# Dictation

The mic button and its shortcut (`lib/use-dictation.ts`) record from the microphone and send the recording to
`POST /api/transcribe`, which turns it into text on this Mac with whisper.cpp (`lib/transcribe.ts`). Nothing leaves the Mac.

## One recording, end to end

1. The hook asks `GET /api/transcribe` as the mic opens; with Advanced dictation on, that call starts warming the server.
2. On Stop it posts the audio with `?lang=` set to the board's `navigator.language`.
3. ffmpeg turns it into 16 kHz mono WAV.
4. One pass of whisper, either the warm server or a fresh `whisper-cli`, and a second pass only if the first looks broken.

## What makes it fast

Measured on an M5 with large-v3-turbo and a 9-second prompt: **4.8 s** before, **1.6 s** with the CLI, **0.46 s** with the warm server.

- **A named language.** `-l auto` costs ~1.7 s a recording. Settings → General → Dictation → Language defaults to "System
  language" (the request's `lang`, mapped by `whisperLanguage()` in `lib/dictation-languages.ts`; a code whisper doesn't know
  falls back to detecting). "Detect each time" is still there for people who switch languages.
- **An audio window sized to the clip.** whisper's encoder pads every clip to 30 s (1500 frames, 50 a second). `audioCtx()` gives a
  clip under 20 s its own length plus 3 s (rounded to 64, at least 384) via `-ac` / `audio_ctx`, roughly halving the encode.
  A short window now and then makes whisper loop, so `looksBroken()` (empty, or the same six words twice) reruns it over the
  full window. With a short window, timestamped decoding loops reliably: the CLI passes `-nt`, the server `no_timestamps=true`.
- **Advanced dictation**: a warm `whisper-server` (`lib/whisper-server.ts`) with the model loaded, on 127.0.0.1 and a free port,
  so a recording skips the ~0.85 s model load and Metal start a fresh CLI pays. Concurrent starts share one spawn; it stops after
  5 idle minutes (`IDLE_MS`) and when Weft's server exits, so its 1-2 GB is only held while you dictate. If the server fails, the
  same recording goes through the CLI.

## The model

`lib/whisper-model.ts` looks for a large-v3-turbo on disk (`~/.weft/models`, Superwhisper's, Homebrew's). Turning Advanced dictation
on without one downloads `ggml-large-v3-turbo-q5_0.bin` (~550 MB) from Hugging Face into `~/.weft/models`. The download streams to a
`.part` file and is renamed only once it's complete. The Settings card polls its progress once a second. The CLI path uses the same file
when it's the best model found.

## Vocabulary

Names and terms you list (comma-separated or one per line, under 600 characters) become whisper's initial prompt
(`vocabularyPrompt()`), which nudges it toward your spelling of "Supabase" or "puku-cli".

## Settings

`~/.weft/dictation.json` (`lib/dictation-prefs.ts`): `language`, `advanced`, `vocabulary`. Read and written by
`GET`/`PATCH /api/transcribe/settings`; turning Advanced off stops the server right away.
