#!/usr/bin/env node
// Probes what the app configuration token (SLACK_CONFIG_ACCESS_TOKEN) can reach on a Slack app, and
// prints only *shapes*: which keys came back, and for known-public fields their values. It never prints a
// token, a client secret, or a webhook URL — a secret that reaches a log reaches a transcript.
//
//   pnpm slack:probe <app id>
//
// Why this exists: the feedback webhook's address has no Web API method (docs.slack.dev/reference/methods
// lists none), so the only programmatic route to it is the OAuth answer's incoming_webhook.url. That
// answer needs the app's OAuth client id, and the only place Slack exposes it is a configuration-token
// method. This finds which method that is.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, "..", "lib", "slack-manifest.json"), "utf8"));

// The methods worth asking, in the order worth asking them.
const METHODS = ["apps.manifest.validate", "apps.manifest.update", "apps.manifest.export"];

// Fields that are safe to print: identifiers and counts, never credentials.
const PUBLIC_KEYS = new Set(["app_id", "client_id", "ok", "url", "team_id", "name", "id"]);

async function call(method, token, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// The shape of an answer: which keys it has, and the value of the safe ones. A credential shows as its
// key name only, so the reader can see that a client secret is there without seeing it.
function shape(answer) {
  if (!answer || typeof answer !== "object") return String(answer);
  const out = {};
  for (const [key, value] of Object.entries(answer)) {
    // Slack's error codes and messages are never secrets, and they're the whole point of a probe.
    if (key === "error" || key === "req_method" || key === "needed" || key === "provided") out[key] = value;
    else if (PUBLIC_KEYS.has(key)) out[key] = typeof value === "string" && value.length > 80 ? `${value.slice(0, 12)}…` : value;
    else if (value && typeof value === "object") out[key] = shape(value);
    else out[key] = `<${typeof value}>`;
  }
  return out;
}

// The body a method wants: the app, plus the manifest itself for the two methods that take one.
function bodyFor(method, appId) {
  const body = { app_id: appId };
  if (method === "apps.manifest.export") body.include_apps = true;
  // validate and update both take the manifest itself.
  if (method === "apps.manifest.validate" || method === "apps.manifest.update") {
    body.manifest = JSON.stringify(manifest);
  }
  return body;
}

// The parts of a manifest worth comparing: the scopes, and whether Incoming Webhooks is on.
function summarize(remote) {
  return {
    bot_scopes: remote.oauth_config?.scopes?.bot,
    user_scopes: remote.oauth_config?.scopes?.user ?? null,
    incoming_webhooks: remote.settings?.incoming_webhooks ?? remote.features?.incoming_webhooks ?? null,
  };
}

async function main() {
  const appId = process.argv[2];
  const token = process.env.SLACK_CONFIG_ACCESS_TOKEN;
  if (!/^A[A-Z0-9]+$/.test(appId ?? "")) throw new Error("Give the app's ID, like A0123ABCD.");
  if (!token) throw new Error("SLACK_CONFIG_ACCESS_TOKEN isn't in the env: run this through the vault.");

  for (const method of METHODS) {
    const answer = await call(method, token, bodyFor(method, appId));
    console.log(`\n${method}`);
    console.log(JSON.stringify(shape(answer), null, 2));
  }

  // The manifest we ship, checked against the app the token can see: does the app already have the
  // incoming-webhook scope and the incoming_webhooks setting turned on?
  const exported = await call("apps.manifest.export", token, { app_id: appId });
  const remote = exported?.manifest;
  if (remote) {
    console.log("\nthe app's own manifest");
    console.log(JSON.stringify(summarize(remote), null, 2));
  }
  console.log("\nours");
  console.log(JSON.stringify(summarize(manifest), null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
