// The splash's timing, in one place: how long the poster holds, how long it fades, and the total lead the story
// starts after (hold + fade).
//
// This is the only copy of these numbers. player.js reads them to time the splash, and the three render scripts
// read them for the same reason — the renderer asks for frames across the lead, the encoder delays the narration
// by it, and the verifier expects the video to be that much longer than the story. When they were written out in
// each file, retiming the splash silently desynchronised the picture from the voice.
//
// The page loads it as a plain script (it sets window.WEFT_SPLASH); the scripts read it with require().

var WEFT_SPLASH = { hold: 1.5, fade: 0.5, lead: 2.0 };

if (typeof module !== "undefined" && module.exports) module.exports = WEFT_SPLASH;
