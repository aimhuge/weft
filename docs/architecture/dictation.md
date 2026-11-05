# Dictation

The mic button and its shortcut (`lib/use-dictation.ts`) record from the microphone and send the recording to
`POST /api/transcribe`, which turns it into text on this computer with whisper.cpp (`lib/transcribe.ts`). Nothing leaves the machine.
In the desktop app the shortcut works in every app, through a floating pill (below); on weft.zip the composer records on its own.

## Anywhere

The dictation key (⌥' unless rebound in Settings → Shortcuts) is a system-wide hotkey, like Superwhisper's.

```
⌥' in any app ─► main (electron/dictation-helper.cjs) ─► floating pill (app/dictate, components/DictationPill.tsx)
                   shows the pill, holds Esc                records with useDictation, chimes, POST /api/transcribe
                                                                │ text
                 electron/dictation-insert.cjs ◄────────────────┘
                   clipboard, then: Weft field → insertText · other app's text box → ⌘V · no text box → clipboard only
```

- **The pill** is a transparent, non-activating panel (`type: "panel"`, `focusable: false`) at the top centre of the screen the
  mouse is on, above every Space and full-screen app (`screen-saver` level). It never takes focus, so the caret stays where you
  were typing; its stop square still takes clicks. It loads once the server is up and is only hidden between uses, so a press
  shows it at once. A server that comes back on another port gets a fresh pill on the next press.
- **Esc** is registered globally only while the pill records (`holdEscape`), so other apps have it the rest of the time.
- **The key** lives in the board's localStorage (`lib/shortcuts.ts`); the board sends it as an Electron accelerator
  (`bindingAccelerator`) on load and on every change, and main swaps its registration.
- **Where the text goes** (`createDictationInsert`): it always goes on the clipboard first. With Weft active, the focused page
  says whether the caret is in an input, textarea or editor (`PROBE_SCRIPT`) and `webContents.insertText` types it, with a space
  when it would run into the word before. With another app active, one `osascript` asks System Events for the focused element
  (turning on `AXManualAccessibility` so Chromium and Electron apps answer); a text role (`TEXT_ROLES`) or a selected-text range
  gets ⌘V. Without Accessibility, macOS is asked once a launch and the pill says "Copied · allow Accessibility to paste".
  The first paste also brings macOS's "Weft wants to control System Events" (Automation, `NSAppleEventsUsageDescription`).
- **The composer's mic** stays, for discoverability: in the desktop app it puts the caret back in its composer and starts the
  pill (`lib/use-desktop-dictation.ts`), and mirrors the pill's state (relayed by main to the board and the copilot).
- **Chimes** (`lib/dictation-chimes.ts`): two soft notes, E5→A5 to start and A5→E5 to stop, synthesised with Web Audio, so
  there are no sound files. Settings → General → Dictation → Start and stop sounds turns them off.

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

## Windows

Same pipeline, with whisper.cpp bundled in the installer (`toolchain/whisper`), the board sending a 16 kHz mono WAV
(`lib/wav-encode.ts`) so ffmpeg isn't needed, and text pasted into other apps with Ctrl+V through a hidden PowerShell
(`electron/dictation-insert.cjs`). Details: docs/architecture/windows.md#dictation.

## The model

`lib/whisper-model.ts` looks for a large-v3-turbo on disk (`~/.weft/models`, Superwhisper's, Homebrew's). Turning Advanced dictation
on without one downloads `ggml-large-v3-turbo-q5_0.bin` (~550 MB) from Hugging Face into `~/.weft/models`. The download streams to a
`.part` file and is renamed only once it's complete. The Settings card polls its progress once a second. The CLI path uses the same file
when it's the best model found.

## Vocabulary

Names and terms you list (comma-separated or one per line, under 600 characters) become whisper's initial prompt
(`vocabularyPrompt()`), which nudges it toward your spelling of "Supabase" or "puku-cli".

## Settings

`~/.weft/dictation.json` (`lib/dictation-prefs.ts`): `language`, `advanced`, `vocabulary`, `sounds`. Read and written by
`GET`/`PATCH /api/transcribe/settings`; turning Advanced off stops the server right away.
