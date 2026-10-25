#!/usr/bin/env node
// Puts Weft's Slack app manifest (lib/slack-manifest.json: Socket Mode, /weft, the bot's scopes) on an existing Slack
// app, so its settings match what electron/slack.cjs expects. Run through the vault, which puts the app
// configuration token in the env (docs/architecture/slack.md):
//
//   pnpm slack:manifest <app id>        e.g. A0123ABCD, from the app's Basic Information page
//
// SLACK_CONFIG_ACCESS_TOKEN is a 12-hour app configuration token from api.slack.com/apps (Your App Configuration
// Tokens). When it has expired, generate a new one there: rotating it here would hand back a new pair nobody stores.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, "..", "lib", "slack-manifest.json"), "utf8"));

async function call(method, token, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function explain(answer) {
  const details = (answer.errors ?? []).map((e) => `  ${e.pointer ?? ""} ${e.message ?? ""}`.trimEnd());
  return [`Slack said ${answer.error}`, ...details].join("\n");
}

async function main() {
  const appId = process.argv[2];
  const token = process.env.SLACK_CONFIG_ACCESS_TOKEN;
  if (!/^A[A-Z0-9]+$/.test(appId ?? "")) throw new Error("Give the app's ID, like A0123ABCD (Basic Information → App ID).");
  if (!token) throw new Error("SLACK_CONFIG_ACCESS_TOKEN isn't in the env: run this through the vault.");
  const checked = await call("apps.manifest.validate", token, { app_id: appId, manifest: JSON.stringify(manifest) });
  if (!checked.ok) throw new Error(explain(checked));
  const updated = await call("apps.manifest.update", token, { app_id: appId, manifest: JSON.stringify(manifest) });
  if (!updated.ok) throw new Error(explain(updated));
  console.log(`Updated ${appId}: Socket Mode on, /weft, app_mention, ${manifest.oauth_config.scopes.bot.length} bot scopes.`);
  if (updated.permissions_updated) console.log("The scopes changed: reinstall the app to the workspace (OAuth & Permissions → Reinstall).");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
