// The welcome tour's beats page (public/welcome/beats.html): its scenes in order, each with the beat it shows, the
// element it draws into and how long it runs. One list: the tour's order (lib/welcome-loop.ts), the narration's cues
// (scripts/narrate-welcome.mjs) and the tour video's cut (scripts/render-welcome-loop.mjs) all read it, and the
// page's own copy is pinned to it by a test (lib/welcome-loop.test.ts).
export const SCENES = [
  { beat: "tools", element: "#sceneT", seconds: 5 },
  { beat: "vault", element: "#sceneV", seconds: 5.8 },
  { beat: "pane", element: "#sceneP", seconds: 11.9 },
  { beat: "quality", element: "#sceneB", seconds: 5.6 },
  { beat: "blastcp", element: "#sceneK", seconds: 10.3 },
  { beat: "profile", element: "#sceneA", seconds: 4.6 },
  { beat: "opensource", element: "#sceneO", seconds: 7.8 },
  { beat: "keys", element: "#sceneY", seconds: 17.4 },
] as const;

export type Scene = (typeof SCENES)[number];

// The beats the beats page shows, in order.
export type SceneBeat = Scene["beat"];

// Where a scene starts, in seconds: the sum of the scenes before it. A hundredth of a second is the precision the
// scenes are written in, so the sums are rounded to it and don't drift into 51.00000000000001.
export function sceneStart(beat: SceneBeat): number {
  let at = 0;
  for (const scene of SCENES) {
    if (scene.beat === beat) return Math.round(at * 100) / 100;
    at += scene.seconds;
  }
  return Math.round(at * 100) / 100;
}

// The whole page, all its scenes together.
export const SCENE_SECONDS = Math.round(SCENES.reduce((n, scene) => n + scene.seconds, 0) * 100) / 100;
