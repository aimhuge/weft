import fs from "node:fs";
import type { TProbe } from "./tprobe-types";

// The type lives in lib/tprobe-types.ts, not here: this module imports node:fs, so a client
// module that imports anything from it drags node:fs into the browser chunk.
export type { TProbe };
export const readIt = (): TProbe => ({ x: fs.readFileSync("/tmp/tprobe", "utf8") });
