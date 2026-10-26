// The shapes of the welcome screens, in a file of types only.
//
// They live here, not in lib/welcome.ts / lib/welcome-preview.ts / lib/github-profile.ts, because the
// board's welcome dialog and its sync prompt name them (lib/welcome-client.ts, lib/use-sync-prompt.ts)
// — and a client module that names a server module's type still makes Turbopack resolve that server
// module, which reads ~/.weft/welcome.json with node:fs and shells out with node:child_process. A
// browser chunk can't hold those, so the whole board failed to compile.
//
// Level and Attribute are spelled out here rather than imported: lib/game.ts is pure, but
// lib/game-attributes.ts reaches lib/craft.ts (node:fs) for its functions, and these two are the only
// parts of it the client needs.

// One level of the Wefter Profile: its number, its name, and the XP at its floor and the next one.
export interface Level {
  level: number;
  title: string;
  // XP at the start of this level and of the next.
  floor: number;
  next: number;
}

// One of the profile's three strongest attributes.
export interface Attribute {
  id: string;
  icon: string;
  label: string;
  value: number;
  // How it's measured, with your number.
  hint: string;
}

export interface Welcome {
  // When it was answered; history is what happened before this.
  at: number;
  // Your Claude Code history counts toward XP, streaks and your class. Opt out to start from zero.
  countHistory: boolean;
  // Start fresh: sessions that were quiet before `at` stay off the board.
  fresh: boolean;
  // Project folders left unticked, whose sessions stay off the board.
  skip: string[];
  // A board from before the welcome existed, adopted as it was (history counts, everything imports).
  legacy?: boolean;
  // Settings → General's "Test it": show the real welcome again over this answer, which stays in force
  // (profile, imports) until the welcome is answered anew.
  test?: boolean;
}

export interface WelcomeProject {
  cwd: string;
  // The folder's name, and where it is with ~ for your home folder.
  name: string;
  where: string;
  sessions: number;
  last: number;
  // A worktree, scratch or temp folder: shown folded and unticked.
  scratch: boolean;
}

export interface WelcomeProfile {
  className: string;
  level: Level;
  xp: number;
  sessions: number;
  shipped: number;
  bestStreak: number;
  projects: number;
  // Your three strongest attributes.
  top: Attribute[];
}

export interface GithubProfile {
  login: string;
  name: string | null;
  bio: string | null;
  avatarUrl: string | null;
  url: string;
  company: string | null;
  location: string | null;
  blog: string | null;
  followers: number;
  publicRepos: number;
}
