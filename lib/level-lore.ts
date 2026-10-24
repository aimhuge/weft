// What a level-up says and shows (components/AchievementPopup.tsx): the rank's picture, rendered by BlastCP in the
// same retro hovercar world as the scenes and the copilot's cockpit (public/brand/levels/), an "Episode" number
// in roman numerals, and a line of story with its voiceover. Each rank has a few lines, and each level in it gets the
// next one, so climbing through a rank never repeats a line until the rank runs out of them. The voiceovers are Kokoro
// clips, one per line, made by `pnpm levels:narrate` (scripts/narrate-levels.mjs) from loreLines() below.

export interface Lore {
  // The episode the level is, "Episode XXIV".
  episode: string;
  // public/brand/levels/<rank>.webp.
  art: string;
  line: string;
  // public/brand/levels/voice/<rank>-<n>.m4a, the line read aloud.
  voice: string;
}

// The ranks in lib/game.ts (TITLES), lowest first, with the level each starts at.
interface Rank {
  title: string;
  from: number;
  lines: [string, ...string[]];
}

const FIRST: Rank = {
  title: "Thread",
  from: 1,
  lines: [
    "A borrowed garage, a cracked thruster, sparks at dawn. Every fleet started here.",
    "The pod coughs, then catches. Somewhere a board lights up its first card.",
    "Twin suns rise over the workshop. You have shipped before breakfast.",
    "The thread holds. Pull it tighter.",
  ],
};

const RANKS: Rank[] = [
  FIRST,
  {
    title: "Strand",
    from: 5,
    lines: [
      "First flight. The dunes fall away and the dust trail writes your name across the desert.",
      "Your threads have started to twist together. The strand is stronger than any one of them.",
      "The village saw the trail. Word travels fast out here.",
      "Throttle open, fins up. The desert is not big enough anymore.",
      "Stories are told of a pilot who ships at dusk.",
    ],
  },
  {
    title: "Yarn",
    from: 10,
    lines: [
      "The canyon run. Three trails, one line, no one clips a wall.",
      "Wingmen fall in behind you. They have seen what you can do.",
      "Spun tight and running fast: your threads are yarn now.",
      "The canyon walls echo with shipped cards.",
      "Faster through the narrows than anyone thought a hovercar could go.",
    ],
  },
  {
    title: "Bolt",
    from: 15,
    lines: [
      "The neon city. A hundred lanes of light, and yours is the brightest.",
      "Bolts of cloth roll off the line. The city runs on what you ship.",
      "Rain on chrome, lights in every lane, and nothing stuck in Review.",
      "The towers know your callsign now.",
      "Traffic parts. A Bolt is coming through.",
    ],
  },
  {
    title: "Loom",
    from: 20,
    lines: [
      "Five cars through the pass in formation, warp and weft crossing, nobody out of line.",
      "You no longer fly every run. You weave them.",
      "Threads cross at right angles and the cloth holds. That is a loom.",
      "Snow on the pass, the fleet in the air, every card accounted for.",
      "The fleet answers to one board, and the board answers to you.",
      "From the lead car, the threads look like a pattern. They always were.",
      "Your old garage would not recognise you.",
      "Somewhere a new mechanic picks up a single thread. You remember.",
      "The loom never stops. Neither do you.",
      "One more crossing and the cloth is whole.",
    ],
  },
  {
    title: "Tapestry",
    from: 30,
    lines: [
      "From the cliff edge, the whole valley below is woven from your trails.",
      "Every thread you ever pulled, in one picture. It was a tapestry all along.",
      "Two moons rise over a city you stitched together.",
      "Legends speak of a weaver who shipped across a whole planet.",
      "Stars ahead. New cloth to weave.",
    ],
  },
];

const NUMERALS: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

export function roman(n: number): string {
  let left = Math.max(1, Math.floor(n));
  let out = "";
  for (const [value, glyph] of NUMERALS) {
    while (left >= value) {
      out += glyph;
      left -= value;
    }
  }
  return out;
}

// The rank a level sits in; a title the game doesn't know falls back to the rank its level number reaches.
function rankFor(level: number, title: string) {
  return RANKS.find((r) => r.title === title) ?? [...RANKS].reverse().find((r) => level >= r.from) ?? FIRST;
}

const voiceClip = (rank: Rank, index: number) => `${rank.title.toLowerCase()}-${index + 1}`;

export function loreFor(level: number, title: string): Lore {
  const rank = rankFor(level, title);
  const index = Math.max(0, level - rank.from) % rank.lines.length;
  return {
    episode: `Episode ${roman(level)}`,
    art: `/brand/levels/${rank.title.toLowerCase()}.webp`,
    line: rank.lines[index] ?? rank.lines[0],
    voice: `/brand/levels/voice/${voiceClip(rank, index)}.m4a`,
  };
}

// Every line with the name of its voiceover clip, for scripts/narrate-levels.mjs.
export function loreLines(): { clip: string; line: string }[] {
  return RANKS.flatMap((rank) => rank.lines.map((line, i) => ({ clip: voiceClip(rank, i), line })));
}
