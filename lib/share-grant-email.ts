// The email a person gets when a card's owner names them on a share by GitHub account
// (docs/architecture/sharing.md#people), in the invite email's palette (lib/invite-email.ts). It carries the card's
// emoji and title and, for a mention, the owner's own words (already redacted and clipped): never the thread itself.
// It's a growth email as much as a notice: one button, "Open with GitHub", which is a weft.zip sign-up for most.

export interface GrantEmailFacts {
  sharer: string; // the owner's name, or their login
  sharerLogin: string | null;
  login: string; // the person's GitHub login
  title: string;
  emoji: string | null;
  note: string | null;
  url: string; // the share link
}

const C = { canvas: "#eef1f6", card: "#ffffff", line: "#e3e5ec", ink: "#1d2133", muted: "#555b72", faint: "#868ca2", accent: "#b84f72" };
const SANS = "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// A mention reads as a question to you; a share as a thing to look at.
export function grantSubject(f: GrantEmailFacts): string {
  return f.note ? `${f.sharer} mentioned you in "${f.title}"` : `${f.sharer} shared a thread with you: ${f.title}`;
}

function byline(f: GrantEmailFacts): string {
  return f.sharerLogin ? `${f.sharer} (@${f.sharerLogin})` : f.sharer;
}

export function grantEmailText(f: GrantEmailFacts): string {
  const lines = [`Hi @${f.login},`, "", f.note ? `${byline(f)} mentioned you in a Weft thread:` : `${byline(f)} gave you access to a Weft thread:`, ""];
  if (f.note) lines.push(`  "${f.note}"`, "");
  lines.push(`${f.emoji ? `${f.emoji} ` : ""}${f.title}`, "Live: the AI's work and the page it's showing, as it happens.", "", "Open it with GitHub:", f.url, "");
  lines.push(`Sign in with the GitHub account @${f.login} and you're in, no password. You got this because ${f.sharerLogin ? `@${f.sharerLogin}` : f.sharer} named you on the link; if that's a mistake, ignore it and nothing happens.`);
  return lines.join("\n");
}

export function grantEmailHtml(f: GrantEmailFacts): string {
  const origin = new URL(f.url).origin;
  const [login, title, url] = [f.login, f.title, f.url].map(esc);
  const who = esc(byline(f));
  const p = `margin:0 0 16px;font:15px/1.6 ${SANS};color:${C.muted};`;
  const quote = f.note
    ? `<blockquote style="margin:0 0 20px;padding:12px 16px;border-left:3px solid ${C.accent};background:${C.canvas};border-radius:8px;font:15px/1.6 ${SANS};color:${C.ink};">${esc(f.note)}</blockquote>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>${esc(grantSubject(f))}</title></head>
<body style="margin:0;padding:0;background:${C.canvas};">
<div style="display:none;max-height:0;overflow:hidden;">${f.note ? esc(f.note) : `${who} shared ${title} with you on Weft.`}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 4px 16px;font:600 15px/1 ${SANS};color:${C.ink};">
<img src="${origin}/brand/email/mark.png" width="24" height="24" alt="" style="vertical-align:middle;border-radius:6px;margin-right:8px;">Weft
</td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:16px;padding:32px 36px 36px;">
<p style="margin:0 0 8px;font:600 12px/1 ${SANS};letter-spacing:.08em;text-transform:uppercase;color:${C.accent};">${f.note ? "You were mentioned" : "Shared with you"}</p>
<p style="${p}">Hi @${login}, <strong style="color:${C.ink};font-weight:600;">${who}</strong> ${f.note ? "mentioned you in a Weft thread:" : "gave you access to a Weft thread:"}</p>
${quote}<div style="margin:0 0 20px;padding:14px 16px;border:1px solid ${C.line};border-radius:12px;">
<div style="font:600 17px/1.3 ${SANS};color:${C.ink};">${f.emoji ? `${esc(f.emoji)} ` : ""}${title}</div>
<div style="margin-top:4px;font:13px/1.5 ${SANS};color:${C.faint};">Live: the AI's work and the page it's showing, as it happens.</div></div>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr>
<td style="background:${C.ink};border-radius:10px;"><a href="${url}" style="display:inline-block;padding:13px 26px;font:600 15px/1 ${SANS};color:#ffffff;text-decoration:none;">Open with GitHub</a></td>
</tr></table>
<p style="margin:0;padding-top:16px;border-top:1px solid ${C.line};font:13px/1.6 ${SANS};color:${C.faint};">Sign in with the GitHub account @${login} and you're in, no password.<br><a href="${url}" style="color:${C.accent};word-break:break-all;">${url}</a></p>
</td></tr>
<tr><td style="padding:20px 4px 0;font:12px/1.6 ${SANS};color:${C.faint};">
You got this because ${esc(f.sharerLogin ? `@${f.sharerLogin}` : f.sharer)} named you on the link. If that's a mistake, ignore it and nothing happens.<br>
<a href="${origin}" style="color:${C.faint};">Weft · ${esc(new URL(origin).host)}</a>
</td></tr>
</table></td></tr></table>
</body></html>`;
}
