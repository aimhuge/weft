import { norm, shownFolders as pickFolders } from "./db-picker";
import { folderName } from "./format";

// What the BlastCP drawer shows, from what Electron main's BlastCP side (electron/blastcp.cjs) sends. The
// sign-in never reaches the board: main keeps it in the Keychain and makes every call.

export interface BlastcpPost {
  id: string;
  platform: string;
  // draft, scheduled, publishing, awaiting_human, published, failed or canceled.
  status: string;
  title: string | null;
  scheduledFor: number | null;
  publishedAt: number | null;
  // The post on its platform, once it's out.
  url: string | null;
  // The post's page in BlastCP.
  reviewUrl: string | null;
}

// A folder's property: a workspace (org) and a property in it, and its page in BlastCP.
export interface BlastcpLink {
  org: string;
  property: string;
  name: string;
  url: string;
}

export interface BlastcpFolder {
  folder: string;
  link: BlastcpLink | null;
  // The property's newest posts; null until BlastCP answers.
  posts: BlastcpPost[] | null;
  // BlastCP couldn't read the linked property.
  error: string | null;
}

export interface BlastcpStatus {
  signedIn: boolean;
  user: { email: string } | null;
  // When the sign-in runs out (BlastCP gives 30 days and no refresh), or null.
  expiresAt: number | null;
  // The saved sign-in didn't work.
  error: string | null;
  folders: BlastcpFolder[];
  // The sign-in came from your Weft account (lib/blastcp-auto.ts), not a Connect in the browser.
  viaWeft?: boolean;
  // Your Weft email already has a BlastCP account: this BlastCP page confirms the link once.
  linkUrl?: string | null;
}

// What connecting with your Weft account came to (lib/blastcp-auto.ts, electron/blastcp.cjs connectWeft).
export type WeftConnect =
  | { state: "connected"; email?: string; created?: boolean }
  | { state: "link"; linkUrl: string }
  // You disconnected BlastCP, so only the drawer's button connects it again.
  | { state: "off" }
  // This BlastCP can't swap a Weft sign-in yet, or there's no desktop app to keep the sign-in.
  | { state: "unavailable" }
  | { state: "signed-out" };

// The drawer's toast for a Weft connect that didn't end connected, or null when it did.
export function weftConnectNote(result: WeftConnect): string | null {
  switch (result.state) {
    case "connected":
      return null;
    case "link":
      return "Your email already has a BlastCP account. Confirm it on BlastCP, then connect again.";
    case "signed-out":
      return "Sign in to your Weft account first (top right), then connect again.";
    case "off":
      return "BlastCP is disconnected. Click Connect with your Weft account to turn it back on.";
    case "unavailable":
      return "BlastCP can't take a Weft sign-in yet. Use Connect in the browser instead.";
  }
}

export interface BlastcpWorkspace {
  slug: string;
  name: string;
  properties: { slug: string; name: string }[];
}

// window.weft.blastcp, from electron/preload.cjs.
export interface BlastcpBridge {
  status(folders: string[]): Promise<BlastcpStatus>;
  connect(): Promise<{ email: string }>;
  forget(): Promise<{ signedIn: false }>;
  workspaces(): Promise<BlastcpWorkspace[]>;
  link(folder: string, org: string, property: string, name: string): Promise<{ linked: true; name: string }>;
  // Makes a property in a workspace and links the folder to it.
  createProperty(folder: string, org: string, name: string): Promise<{ linked: true; name: string }>;
  unlink(folder: string): Promise<{ linked: false }>;
}

export const SITE = "https://blastcp.com";

export function blastcpBridge(): BlastcpBridge | null {
  return (typeof window !== "undefined" && window.weft?.blastcp) || null;
}

// The board reloaded onto BlastCP before Electron main did: main keeps the code it launched with, so its
// BlastCP handlers only arrive with the next restart.
export const needsRestart = (error: string | null) => !!error && error.includes("No handler registered for 'blastcp:");

// Restarts Weft. A main from before "relaunch" ignores it, so after a moment quit instead, and Weft opens on
// the new main next time. Returns false outside the desktop shell.
export function restartWeft(wait = 1500) {
  const shell = typeof window !== "undefined" ? window.weft : undefined;
  if (!shell?.splashAction) return false;
  shell.splashAction("relaunch");
  setTimeout(() => shell.splashAction?.("quit"), wait);
  return true;
}

// The folders the drawer shows: the top bar's project only, or every one (lib/db-picker.ts).
export function shownFolders(folders: BlastcpFolder[], project: string | null) {
  return pickFolders(folders, project);
}

// A linked property at a glance: what goes out next (soonest first), and what's waiting on you.
export function queueOf(posts: BlastcpPost[], now: number) {
  const count = (status: string) => posts.filter((p) => p.status === status).length;
  const next = posts
    .filter((p): p is BlastcpPost & { scheduledFor: number } => (p.status === "scheduled" || p.status === "publishing") && p.scheduledFor !== null)
    .sort((a, b) => a.scheduledFor - b.scheduledFor);
  const last = posts
    .filter((p): p is BlastcpPost & { publishedAt: number } => p.status === "published" && p.publishedAt !== null)
    .sort((a, b) => b.publishedAt - a.publishedAt)[0];
  return { next, drafts: count("draft"), waiting: count("awaiting_human"), failed: count("failed"), last: last ?? null, overdue: next.filter((p) => p.scheduledFor < now).length };
}

// "in 40m", "in 5h", "in 3d"; "now" once it's due.
export function untilText(at: number, now: number) {
  const mins = Math.round((at - now) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `in ${hours}h` : `in ${Math.round(hours / 24)}d`;
}

const PLATFORMS: Record<string, string> = {
  linkedin: "LinkedIn",
  substack: "Substack",
  facebook: "Facebook",
  instagram: "Instagram",
  threads: "Threads",
  youtube: "YouTube",
  tiktok: "TikTok",
  gmail: "Gmail",
  resend: "Resend",
  email: "Email",
};

export const platformName = (platform: string) => PLATFORMS[platform] ?? (platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : "Post");

// The line under a property: drafts, posts waiting on a human, failures. Empty when there's none.
export function countsLine(q: Pick<ReturnType<typeof queueOf>, "drafts" | "waiting" | "failed">) {
  const parts = [q.drafts && `${q.drafts} draft${q.drafts === 1 ? "" : "s"}`, q.waiting && `${q.waiting} to approve`, q.failed && `${q.failed} failed`];
  return parts.filter(Boolean).join(" · ");
}

// Says when the sign-in runs out once it's within a week, so a reconnect isn't a surprise.
export function expiryNote(expiresAt: number | null, now: number) {
  if (!expiresAt) return null;
  const days = Math.ceil((expiresAt - now) / 86_400_000);
  if (days > 7) return null;
  return days <= 0 ? "Sign-in ran out" : `Sign-in runs out in ${days} day${days === 1 ? "" : "s"}`;
}

export interface PropertyOption {
  org: string;
  orgName: string;
  slug: string;
  name: string;
  // 2 has the folder's name, 1 a name that contains it either way, 0 none.
  score: number;
}

function fit(name: string, slug: string, folder: string) {
  const want = norm(folderName(folder));
  const names = [norm(name), norm(slug)].filter(Boolean);
  if (!want) return 0;
  if (names.includes(want)) return 2;
  return names.some((n) => n.includes(want) || want.includes(n)) ? 1 : 0;
}

// The picker's list: every property in every workspace that matches the search, best fits first.
export function propertyOptions(workspaces: BlastcpWorkspace[], folder: string, search = ""): PropertyOption[] {
  const q = search.trim().toLowerCase();
  return workspaces
    .flatMap((w) => w.properties.map((p) => ({ org: w.slug, orgName: w.name, slug: p.slug, name: p.name, score: fit(p.name, p.slug, folder) })))
    .filter((o) => !q || [o.name, o.slug, o.orgName].some((s) => s.toLowerCase().includes(q)))
    .sort((a, b) => b.score - a.score);
}

// A new property's starting name: what you searched for, else the folder's name in words ("my-app" → "My App").
export function newPropertyName(folder: string, search = "") {
  const typed = search.trim();
  if (typed) return typed;
  return folderName(folder)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Creates a property and links the folder to it. A board window from before this landed has no
// createProperty, and a main from before it has no handler: both need one restart.
export async function createProperty(bridge: BlastcpBridge, folder: string, org: string, name: string) {
  const restart = new Error("Restart Weft to create BlastCP properties from here.");
  if (typeof bridge.createProperty !== "function") throw restart;
  try {
    return await bridge.createProperty(folder, org, name);
  } catch (err) {
    throw needsRestart(String(err)) ? restart : err;
  }
}

// The rail icon's hover text.
export function blastcpTitle(status: BlastcpStatus | null, project: string | null) {
  if (!status?.signedIn) return "BlastCP: connect your posting queue";
  const linked = shownFolders(status.folders, project).filter((f) => f.link);
  if (!linked.length) return "BlastCP: no property linked yet";
  return `BlastCP: ${linked.map((f) => f.link?.name).join(", ")}`;
}
