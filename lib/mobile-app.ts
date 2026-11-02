// Is this folder a React Native or Expo app? A worker marks such a card (card.mobileApp), so the pane on the board
// offers Start simulator before the thread has streamed anything (components/web-board/WebPane.tsx).
import fs from "node:fs";
import path from "node:path";

const MOBILE = ["react-native", "expo"];

export function isMobileApp(dir: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    return MOBILE.some((name) => Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]));
  } catch {
    return false;
  }
}
