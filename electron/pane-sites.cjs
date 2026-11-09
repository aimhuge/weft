// The sites a thread may open in the browser pane without asking (electron/pane-origins.cjs): this Mac's own
// pages (localhost and the like), the top 1000 sites from Tranco (pane-top-sites.json) minus the ones you'd be
// signed into, and every host you said yes to once. The yeses live in ~/.weft/pane-sites.json, so they hold
// across cards and restarts, and Settings → Security lists them to take back out.
const fs = require("node:fs");
const path = require("node:path");
const { sites: TOP_SITES } = require("./pane-top-sites.json");

// Top sites where the page at the bare domain (or www.) is your signed-in account: mail, money, shopping,
// social, chat, code and cloud dashboards. A thread there could read your inbox, post as you or spend, so these
// still ask once; a yes then lands in the saved list like any other host.
const SIGNED_IN = new Set(`
  paypal.com venmo.com cash.app wise.com coinbase.com binance.com bankofamerica.com chase.com wellsfargo.com
  amazon.com ebay.com walmart.com etsy.com aliexpress.com temu.com taobao.com shopify.com booking.com airbnb.com agoda.com uber.com
  gmail.com outlook.com live.com live.net office.com microsoftonline.com icloud.com skype.com
  facebook.com messenger.com instagram.com whatsapp.com x.com twitter.com tiktok.com linkedin.com reddit.com snapchat.com
  pinterest.com twitch.tv youtube.com discord.com telegram.org slack.com zoom.us qq.com vk.com line.me medium.com
  github.com gitlab.com bitbucket.org vercel.com supabase.com atlassian.net salesforce.com hubspot.com mailchimp.com
  okta.com dropbox.com box.com notion.so figma.com canva.com godaddy.com namecheap.com squarespace.com wix.com
  wordpress.com patreon.com substack.com openai.com chatgpt.com claude.ai netflix.com spotify.com
`.split(/\s+/).filter(Boolean));

const PUBLIC = new Set(TOP_SITES.filter((domain) => !SIGNED_IN.has(domain)));

// This Mac's own servers: a card's dev server, not anyone's account.
function isLocalHost(host) {
  return host === "localhost" || host.endsWith(".localhost") || /^127(\.\d{1,3}){3}$/.test(host) || host === "[::1]" || host === "0.0.0.0";
}

// A top site counts at its bare domain and www. only: mail.google.com and dashboard.stripe.com still ask.
function isTopSite(host) {
  return PUBLIC.has(host) || (host.startsWith("www.") && PUBLIC.has(host.slice(4)));
}

// What you typed or pasted ("tiktok.com", "https://www.tiktok.com/@x") as a host, or "" when it isn't one.
function hostOf(input) {
  const text = String(input ?? "").trim();
  if (!text) return "";
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`).hostname.toLowerCase();
    return /^[a-z0-9.-]+\.[a-z]{2,}$|^\[[0-9a-f:]+\]$/.test(host) ? host : "";
  } catch {
    return "";
  }
}

function createPaneSites(dataDir, fsImpl = fs) {
  const file = path.join(dataDir, "pane-sites.json");
  let saved = read();

  function read() {
    try {
      const sites = JSON.parse(fsImpl.readFileSync(file, "utf8")).sites;
      return new Set(Array.isArray(sites) ? sites.filter((s) => typeof s === "string") : []);
    } catch {
      return new Set();
    }
  }

  function write() {
    fsImpl.mkdirSync(dataDir, { recursive: true });
    fsImpl.writeFileSync(file, `${JSON.stringify({ sites: [...saved].sort() }, null, 2)}\n`);
  }

  return {
    // A host a thread opens with no prompt.
    allows: (host) => isLocalHost(host) || saved.has(host) || isTopSite(host),
    // The hosts you added or said yes to, for Settings.
    list: () => [...saved].sort(),
    add(input) {
      const host = hostOf(input);
      if (!host) return null;
      saved.add(host);
      write();
      return host;
    },
    remove(host) {
      if (!saved.delete(host)) return false;
      write();
      return true;
    },
  };
}

module.exports = { createPaneSites, hostOf, isLocalHost, isTopSite, SIGNED_IN };
