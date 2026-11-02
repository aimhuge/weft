// Bundles sign.weft.zip's script (sign/main.ts) into public/sign/app.js, the only script its pages load
// (lib/sign-origin.ts: a CSP with script-src 'self' and no inline script). Runs before `next build`, so the deploy
// always ships a bundle made from this commit's sources; the output is gitignored.
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = (name) => JSON.stringify(process.env[name] ?? "");

await esbuild.build({
  entryPoints: [path.join(root, "sign/main.ts")],
  outfile: path.join(root, "public/sign/app.js"),
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["safari16", "chrome110", "firefox115"],
  legalComments: "none",
  // Inlined at build, as Next inlines them for the app: an empty value falls back to Weft prod's project.
  define: {
    "process.env.WEFT_SUPABASE_URL": env("WEFT_SUPABASE_URL"),
    "process.env.WEFT_SUPABASE_KEY": process.env.WEFT_SUPABASE_KEY === undefined ? "undefined" : env("WEFT_SUPABASE_KEY"),
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  // libsodium-wrappers 0.7.16's ESM build imports a file it doesn't ship (next.config.ts aliases it the same way); its
  // CommonJS build's Node-only requires sit behind a check and never run in a browser.
  alias: { "libsodium-wrappers": path.join(root, "node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js") },
  external: ["fs", "path", "crypto"],
  logLevel: "warning",
});
