// A lint rule for the client/server boundary: a "use client" file must not reach a module that imports
// a Node built-in, "server-only" or "use cache". Turbopack panics on those ("the chunking context does
// not support external modules") and the board route 500s with nothing the UI can show — on 2026-10-24
// components/ModelSelect.tsx imported lib/model-limit.ts, which reads ~/.weft off disk.
//
// The analysis is lib/client-graph.ts's, the same one lib/client-graph.test.ts walks the real tree with.
// This rule puts it in `pnpm lint` and so in the pre-commit hook, which lints the staged files: a change
// that breaks the board fails the commit instead of the next restart.
//
// The whole tree is analysed once per lint run and each "use client" file reports only the leaks that
// start at it, so the message names the file the author touched.

import path from "node:path";
import { registerHooks } from "node:module";

const DIRS = ["components", "lib", "app"];

// lib/ imports its neighbours without an extension (the bundler's way); Node's type stripping needs
// ".ts". The analyzer is TypeScript, so ESLint's plain ESM loader can't read it — this resolver is the
// same one scripts/import-check-hook.mjs uses.
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

const { clientLeaks } = await import("../lib/client-graph.ts");

let cached = null;

function leaksFor(root) {
  // The tree doesn't change during a lint run, so one walk answers every file's rule.
  if (!cached || cached.root !== root) cached = { root, leaks: clientLeaks(root, DIRS) };
  return cached.leaks;
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "disallow a \"use client\" module from reaching a Node built-in or a server-only module",
    },
    messages: {
      leak:
        'This client module reaches server-only code ({{what}}) through {{chain}}. Break the chain: move what the client needs into a module of its own.',
    },
  },
  create(context) {
    const filename = context.filename;
    // Only the "use client" files themselves report; the rule doesn't need to run on a server module.
    if (!filename || filename.includes("node_modules")) return {};
    return {
      Program(node) {
        const root = context.cwd ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
        const rel = path.relative(root, filename).split(path.sep).join("/");
        const leaks = leaksFor(root).filter((leak) => leak.chain[0] === rel);
        for (const leak of leaks) {
          context.report({
            node,
            messageId: "leak",
            data: {
              what: leak.serverOnly.join(", "),
              chain: leak.chain.join(" → "),
            },
          });
        }
      },
    };
  },
};

export default rule;
