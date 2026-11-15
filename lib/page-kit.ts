import fs from "node:fs";
import path from "node:path";
import { PAGE_KIT_README } from "./page-kit-rules";
import { PLUGIN_DIR } from "./skills";
import { DATA_DIR } from "./store";

// The pane's page kit: one CSS and one script (plugin/skills/research/kit) and their rules (lib/page-kit-rules.ts),
// shared by research pages and every builder thread's own page. Weft keeps a copy at ~/.weft/show/_kit/ so any page under show/ can link
// it relatively; a file is rewritten only when the plugin's copy differs, so an update reaches pages on the next start.
export const KIT_SRC = path.join(PLUGIN_DIR, "skills", "research", "kit");
export const KIT_DIR = path.join(DATA_DIR, "show", "_kit");
const FILES = ["research.css", "research.js"];

let installed = false;

export function installPageKit(src = KIT_SRC, dest = KIT_DIR) {
  if (installed && src === KIT_SRC && dest === KIT_DIR) return;
  try {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of FILES) {
      const from = path.join(src, name);
      if (!fs.existsSync(from)) continue;
      const body = fs.readFileSync(from);
      writeIfChanged(path.join(dest, name), body);
    }
    writeIfChanged(path.join(dest, "README.md"), Buffer.from(PAGE_KIT_README));
    if (src === KIT_SRC && dest === KIT_DIR) installed = true;
  } catch {
    // A page without its kit still reads, unstyled; nothing on the start-a-card path waits on this.
  }
}

function writeIfChanged(to: string, body: Buffer) {
  if (!fs.existsSync(to) || !fs.readFileSync(to).equals(body)) fs.writeFileSync(to, body);
}
