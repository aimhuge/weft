// Claude Code hook (.claude/settings.json) for sessions outside Weft, and for CLIs a board thread starts
// itself (a `puku-cli -p` run); board threads get the same checks in-process (lib/env.ts guardedCli), so it
// skips them (lib/weft-thread.ts). Anything going wrong here never gets in an edit's way.
// - PreToolUse: refuses an edit that makes a route file (app/**/page.tsx, a layout, a route.ts…) import a
//   module that isn't there yet, which would take the whole app down (lib/route-import-guard.ts), or export a
//   segment config cacheComponents refuses, and warns on runtime data awaited outside <Suspense>
//   (lib/prerender-check.ts); and Bash running tsc or eslint directly instead of the pnpm scripts that take
//   turns (lib/check-guard.ts), and a dev server sent to the background outside Weft's tracker
//   (lib/devserver-guard.ts).
// - PostToolUse: after an Edit or Write, tells the session about any import the edit broke
//   (lib/import-check.ts), before the dev server shows it as a build error over the board, and any
//   import it dropped that the file still uses (lib/dropped-imports.ts), which throws when it draws.
// Exit 2 hands the reason back to the agent (and, before the tool runs, stops it).
import { registerHooks } from "node:module";
import path from "node:path";

// lib/ imports its neighbours without an extension (the bundler's way); Node's type stripping needs ".ts".
registerHooks({
  resolve(spec, context, next) {
    try {
      return next(spec, context);
    } catch (err) {
      if (spec.startsWith(".")) return next(`${spec}.ts`, context);
      throw err;
    }
  },
});

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

try {
  const { hookIsWeftThread } = await import("../lib/weft-thread.ts");
  if (hookIsWeftThread()) process.exit(0);
  const { hook_event_name: event, tool_name: tool, tool_input: input, cwd } = JSON.parse(raw);
  const file = input?.file_path;
  if (event === "PreToolUse" && (tool === "Bash" || tool === "Monitor")) {
    const { checkVerdict } = await import("../lib/check-guard.ts");
    const { devServerVerdict } = await import("../lib/devserver-guard.ts");
    const why = typeof input?.command === "string" ? (checkVerdict(input.command, cwd ?? ".") ?? devServerVerdict(tool, input, cwd ?? ".")) : null;
    if (why) {
      process.stderr.write(`${why}\n`);
      process.exit(2);
    }
  } else if (event === "PreToolUse") {
    const { prerenderCheck, routeImportCheck } = await import("../lib/route-import-guard.ts");
    const missing = routeImportCheck(tool, input, cwd ?? ".");
    const { deny, warn } = missing ? { deny: "", warn: "" } : await prerenderCheck(tool, input, cwd ?? ".");
    const why = missing || deny;
    if (why) {
      process.stderr.write(`${why}\n`);
      process.exit(2);
    }
    // A warning lets the edit through and reaches the session as context.
    if (warn) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: warn } }));
  } else if (typeof file === "string") {
    const { brokenImports, importReport } = await import("../lib/import-check.ts");
    const { droppedImports } = await import("../lib/dropped-imports.ts");
    const full = path.resolve(cwd ?? ".", file);
    const problems = [...brokenImports(full), ...droppedImports(tool, input, full)];
    if (problems.length) {
      process.stderr.write(`${importReport(problems)}\n`);
      process.exit(2);
    }
  }
} catch {
  // A malformed payload or a Node without type stripping: say nothing.
}
