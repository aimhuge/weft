import { LEAGUES, QUALITY_BAR, QUALITY_BONUS, XP } from "./game";
import { REPO, RELEASES } from "./home";

// What the weft.zip home page's story sections say (components/home/CardDemo.tsx, Why.tsx, MiniBoard.tsx, Game.tsx,
// OpenSource.tsx), kept beside lib/home.ts so lib/home-story.test.ts can read the words without rendering. The page
// answers, in order: what is inside a card, why this board and not another, what the board looks like, what you earn
// for shipping, and where the source is. No loom talk: visitors asked what a loom was.

export const HERO = {
  eyebrow: "A board of AI coding threads",
  title: "Every card builds it,",
  titleEm: "then shows you.",
  lede:
    "Each card is a Claude Code, Codex or Puku thread working in your repo. Open one and the pane beside it shows what " +
    "it's making, every turn: the running app, a plan, a diff, a review to walk through. No terminal to scroll.",
  note: "Free, with its source on GitHub. Bring the Claude Code, Codex or Puku login you already have.",
};

// The hero's open card: one prompt, then three turns. Each turn is what the thread says and what the pane shows for it.
export interface DemoScene {
  id: "plan" | "app" | "review";
  tab: string;
  says: string;
  url: string;
}

export const DEMO = {
  card: "Pricing page",
  prompt: "Add a pricing page with three plans.",
  scenes: [
    { id: "plan", tab: "Plans it", says: "Here's the plan. It's in the pane: three steps.", url: "plan.html" },
    { id: "app", tab: "Builds it", says: "Built, and running beside us. Click around.", url: "localhost:3000/pricing" },
    { id: "review", tab: "Walks you through it", says: "Ready for review. I've set up a tour: three stops.", url: "localhost:3000/pricing" },
  ] satisfies DemoScene[],
  planSteps: ["Three plan cards from the billing catalog", "Checkout button on Pro and Team", "Phone layout: one column"],
  review: { step: "Stop 1 of 3", title: "The three plans", look: "Check the cards line up and Pro stands out." },
};

// "A lot of people are making kanban": what the others leave you with, and what Weft does instead.
export interface WhyRow {
  them: string;
  title: string;
  body: string;
}

export const WHY: WhyRow[] = [
  {
    them: "A terminal per agent, and a log to scroll",
    title: "A pane per card",
    body: "After every turn the app, the plan or the diff is on screen beside the thread. You look; you don't dig.",
  },
  {
    them: "Review means reading a diff",
    title: "A review tour",
    body: "A finished card walks you through what it built, stop by stop, in the running app. Reply on any stop.",
  },
  {
    them: "A fresh checkout and install per agent",
    title: "Warm threads, one tree",
    body: "A reply starts in about two seconds, and cards warn each other before they touch the same code.",
  },
  {
    them: "API keys pasted into prompts",
    title: "A Touch ID vault",
    body: "Threads fill fields and run commands with your keys, and only ever learn their names.",
  },
];

// The small drawn board: four columns, a handful of cards, and one card that travels across them.
export const BOARD = {
  // Each column, the state a card in it shows, and the cards that sit still in it.
  columns: [
    { name: "Backlog", state: "Queued", cards: ["Dark mode", "Invite emails"] },
    { name: "Running", state: "Building", cards: ["Stripe webhook"] },
    { name: "Review", state: "Tour ready", cards: ["Onboarding flow"] },
    { name: "Done", state: "Shipped", cards: ["Fix login redirect", "Search"] },
  ],
  // The card that travels across them, wearing each column's state in turn.
  traveler: "Pricing page",
  points: [
    { title: "Cards move themselves", body: "Running while a thread works, Review when there's something to see, Done when it's committed, pushed and deployed." },
    { title: "A copilot runs the board", body: "It plans the backlog into cards that won't collide, starts the next one, and turns quality findings into cards." },
    { title: "Your stack on the rail", body: "GitHub, Vercel, Supabase and Cloudflare a click away: issues become cards, migrations and deploys land from the board." },
    { title: "Follow it from anywhere", body: "The same board on weft.zip and on your iPhone, for you and your team." },
  ],
};

// The level art in public/brand/levels, with the level each title starts at (TITLES in lib/game.ts; the test pins them).
export const LEVELS = [
  { title: "Thread", from: 1 },
  { title: "Strand", from: 5 },
  { title: "Yarn", from: 10 },
  { title: "Bolt", from: 15 },
  { title: "Loom", from: 20 },
  { title: "Tapestry", from: 30 },
] as const;

// What earns XP, read from the game's own rules so the page can't promise a number the app doesn't pay.
export function xpRules(): { what: string; xp: string }[] {
  return [
    { what: "Start a card", xp: `+${XP.created}` },
    { what: "Every turn", xp: `+${XP.turn}` },
    { what: "Ship it to Done", xp: `+${XP.done}` },
    { what: `Ship with the project's checks at ${QUALITY_BAR}+`, xp: `+${XP.done * QUALITY_BONUS}` },
  ];
}

export const GAME = {
  // A real public profile, so "see one" is not a mockup.
  example: { handle: "fotoflo", href: "/@fotoflo" },
  body:
    "Weft keeps score of what you ship. Streaks with freezes, 38 badges, a class worked out from how you build, and a weekly " +
    `league of 30 builders that runs from ${LEAGUES[0]} to ${LEAGUES[LEAGUES.length - 1]}.`,
  profile:
    "Sign in with GitHub and your builder card is public at weft.zip/@you: your level, your stack, 26 weeks of activity, " +
    "and the threads and mini apps you chose to share. Never your code, prompts or project names.",
};

// "Open source" as it really is: the source is public under FSL (LICENSE), so the page says where it is and links the terms.
export const OPEN = {
  points: [
    { title: "Read every line", body: "The board, the thread runners, the vault: the whole app is on GitHub, not just a plugin for it." },
    { title: "Weft builds Weft", body: "It is built on its own board, and any thread working in it may open a card to fix what it finds." },
    { title: "Your issues, as cards", body: "Point the GitHub drawer at a repo and its open issues land on the board, ready to start." },
    { title: "Every release, written down", body: "Each version ships with a changelog of what changed and why. Updates arrive in the app." },
  ],
  links: [
    { label: "Star Weft on GitHub", href: REPO, track: "github" },
    { label: "Read the changelog", href: RELEASES, track: "releases" },
  ],
  license: { label: "FSL-1.1-ALv2, with Weft's additional terms", href: `${REPO}/blob/main/LICENSE` },
};
