import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";
import noClientServerLeak from "./eslint-rules/no-client-server-leak.mjs";

const TS_FILES = ["**/*.{ts,tsx,mts,cts}"];
const LINE_COUNT = { skipBlankLines: true, skipComments: true };

// Follow-up: split these files (longest first; SOUL.md hotspots) and extract the complex functions,
// then lower or delete each entry. Never raise one: a file that grows past its number fails lint.
// The cap is there to make you refactor: when a file hits it, name the smell and move code out
// (Extract Function or Module), then lower its number. Never get under it by joining lines, dropping
// blank lines or deleting comments; that hides the smell and makes the file worse.
const OVERSIZE = {
  "components/Board.tsx": 402,
  "lib/runner.test.ts": 901,
  "app/api/routes.test.ts": 766,
  "lib/login.test.ts": 553,
  "lib/import.test.ts": 568,
  "components/Composer.tsx": 556,
  "lib/library.test.ts": 510,
  "lib/board-view.test.ts": 520,
  "components/SettingsDialog.tsx": 471,
  "lib/use-dictation.test.ts": 425,
  "electron/main.cjs": 369,
  "lib/import.ts": 391,
  "lib/library.ts": 391,
  "components/ReplyBox.tsx": 357,
  "components/NewCardDialog.tsx": 331,
  "lib/hotkeys.test.ts": 322,
  "lib/web-board.test.ts": 431,
  "lib/board-tools.ts": 316,
  "lib/login.ts": 297,
  "lib/repos.test.ts": 307,
  "components/RepoPicker.tsx": 304,
  "lib/cloud-sync.test.ts": 561,
  "app/api/thread-page-routes.test.ts": 766,
  "lib/copilot-sources.test.ts": 652,
};
const COMPLEX = {
  "components/Board.tsx": 26,
  "lib/transcript.ts": 43,
  "lib/format.ts": 37,
  "lib/import.ts": 36,
  "components/CardView.tsx": 32,
  "components/MediaNode.tsx": 25,
  // Brackets escaped: a glob reads [id] as a character class.
  "app/api/cards/\\[id\\]/route.ts": 24,
  "components/Composer.tsx": 24,
  "lib/copilot-digest.ts": 22,
  "components/ReplyBox.tsx": 21,
  "lib/card-menu.ts": 20,
  "components/MediaView.tsx": 19,
  "components/ThreadView.tsx": 19,
  "components/RepoPicker.tsx": 18,
  "components/SettingsDialog.tsx": 18,
  "components/use-board-menus.ts": 18,
  "lib/repos.ts": 18,
  "app/api/cards/route.ts": 17,
  "components/NewCardDialog.tsx": 17,
  "electron/main.cjs": 17,
  "lib/library.ts": 17,
  "app/api/settings/route.ts": 16,
  "components/ThreadPanel.tsx": 16,
  "electron/server.cjs": 16,
};

const eslintConfig = defineConfig([
  ...nextVitals,
  // TypeScript rules apply to TypeScript; electron/*.cjs is plain CommonJS and keeps its require().
  ...nextTs.map((c) => (c.rules ? { ...c, files: TS_FILES } : c)),
  // Strict, type-aware rules for every TypeScript file.
  {
    files: TS_FILES,
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // Numbers read fine in a template; objects and undefined are what this rule should catch.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // `onClick={() => setOpen(true)}` is the React idiom, not a confusing void.
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
    },
  },
  // Tests index into fixtures they just built; `!` there says "this test set it up".
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  // Keep files and functions small (SOUL.md: split hotspots, Fowler's Extract Function).
  {
    rules: {
      "max-lines": ["error", { max: 300, ...LINE_COUNT }],
      complexity: ["error", 15],
    },
  },
  // The client/server boundary: a "use client" module must not reach a Node built-in or a server-only
  // module. Turbopack panics on those and the board route 500s with nothing the UI can show, so a change
  // that breaks the board fails lint here instead of the next restart. The analysis is lib/client-graph.ts's.
  {
    files: TS_FILES,
    plugins: { weft: { rules: { "no-client-server-leak": noClientServerLeak } } },
    rules: { "weft/no-client-server-leak": "error" },
  },
  // The ratchet: files over those limits today, each held at its current size so it can only shrink.
  ...Object.entries(OVERSIZE).map(([file, max]) => ({ files: [file], rules: { "max-lines": ["error", { max, ...LINE_COUNT }] } })),
  ...Object.entries(COMPLEX).map(([file, max]) => ({ files: [file], rules: { complexity: ["error", max] } })),
  // Weft is an Electron app showing local files; next/image's optimizer has nothing to do there.
  { rules: { "@next/next/no-img-element": "off" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    // .next plus every sibling build dir (.next-app, .next-dist, .next-bench*, .next-game).
    ".next*/**",
    "dist/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    // The toolchain staged for the packaged app (scripts/bundle-toolchain.mjs): third-party code.
    ".toolchain-dist/**",
    // Leftover installs (node_modules.npm-old) and scratch: ESLint skips only a folder named exactly node_modules.
    "node_modules.*/**",
    ".scratch/**",
    // Vendored, minified third-party bundles (public/welcome/gsap.min.js): not our code to lint.
    "**/*.min.js",
    "**/*.bundle.js",
  ]),
]);

export default eslintConfig;
