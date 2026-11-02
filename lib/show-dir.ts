import path from "node:path";
import { DATA_DIR } from "./store";

// Where threads write the pages they show in the pane (plans, commits, how-tos, answers). It sits in
// ~/.weft beside pages/ and library/ so it survives reboots: macOS clears /tmp, and pages lived there once.
export const SHOW_DIR = path.join(DATA_DIR, "show");
