// The welcome's "how Weft works" loop: public/welcome/loop.html, a HyperFrames composition that plays live in the Get
// ready hero (components/WelcomeLoop.tsx) and renders to an MP4 for weft.zip (scripts/render-welcome-loop.mjs).
// This builds its address: ?live=1 plays it on repeat, ?p= puts up to three of your own project names on its cards.

export const LOOP_PATH = "/welcome/loop.html";

export function loopSrc(names: string[]): string {
  const picked = names
    .map((n) => n.replace(/,/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3);
  const query = new URLSearchParams({ live: "1" });
  if (picked.length) query.set("p", picked.join(","));
  return `${LOOP_PATH}?${query.toString()}`;
}
