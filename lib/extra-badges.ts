// The badge families beyond the first ones, each in its own pure module on lib/badge-kit.ts, gathered in the
// order lib/game-badges.ts lists them. A new family goes in its own module and joins here.
import type { Def } from "./badge-kit";
import { CRAFT_DEFS } from "./craft-badges";
import { EXPLORER_DEFS } from "./explorer-badges";
import { LEAGUE_DEFS } from "./league-badges";
import { MORE_DEFS } from "./more-badges";
import { SPEND_DEFS } from "./spend-badges";
import { TIME_DEFS } from "./time-badges";

export const EXTRA_DEFS: Def[] = [...TIME_DEFS, ...SPEND_DEFS, ...CRAFT_DEFS, ...MORE_DEFS, ...LEAGUE_DEFS, ...EXPLORER_DEFS];
