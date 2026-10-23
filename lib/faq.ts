import { REPO } from "./home";

// docs/FAQ.md on weft.zip: app/faq/page.tsx renders the whole file, components/home/FaqTeaser.tsx shows FAQ_HIGHLIGHTS
// on the home page. The file is written for GitHub, so it holds a little raw HTML (rows of <img> inside <p>) and
// paths relative to docs/. splitFaq() cuts the HTML rows out so react-markdown never sees raw HTML, and webSrc() /
// webHref() turn GitHub-relative paths into ones that work on the site.

export interface FaqImage {
  src: string;
  alt: string;
  width?: string;
}

export type FaqSegment = { kind: "markdown"; text: string } | { kind: "images"; images: FaqImage[] };

const IMG = /<img\s[^>]*>/g;

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
}

export function parseImages(html: string): FaqImage[] {
  return (html.match(IMG) ?? []).flatMap((tag) => {
    const src = attr(tag, "src");
    if (!src) return [];
    const width = attr(tag, "width");
    return [{ src, alt: attr(tag, "alt") ?? "", ...(width ? { width } : {}) }];
  });
}

// The markdown between image rows, in order. A row is a <p>…</p> block of <img> tags or a lone <img> line.
export function splitFaq(md: string): FaqSegment[] {
  const out: FaqSegment[] = [];
  let text: string[] = [];
  const flush = () => {
    if (text.join("").trim()) out.push({ kind: "markdown", text: text.join("\n") });
    text = [];
  };
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = raw.trim();
    if (line === "<p>") {
      const row: string[] = [];
      for (i++; i < lines.length && (lines[i] ?? "").trim() !== "</p>"; i++) row.push(lines[i] ?? "");
      flush();
      out.push({ kind: "images", images: parseImages(row.join("\n")) });
    } else if (line.startsWith("<img ")) {
      flush();
      out.push({ kind: "images", images: parseImages(line) });
    } else {
      text.push(raw);
    }
  }
  flush();
  return out;
}

// ../public/brand/x.png (relative to docs/) is /brand/x.png on the site; anything else is left alone.
export function webSrc(src: string): string {
  return src.startsWith("../public/") ? src.slice("../public".length) : src;
}

// Anchors and absolute links stay; a path relative to docs/ (../README.md, architecture/secrets.md) opens on GitHub.
export function webHref(href: string): string {
  if (href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  const parts: string[] = [];
  for (const part of `docs/${href}`.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return `${REPO}/blob/main/${parts.join("/")}`;
}

// GitHub's heading anchor, so the FAQ's own table of contents (#the-basics) works on the site too:
// lowercase, drop everything but letters, digits, spaces, hyphens and underscores, then each space becomes a hyphen.
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/ /g, "-");
}

// The plain text of a heading react-markdown hands over as children (strings, arrays, <code> elements).
export function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) return textOf((node as { props: { children?: unknown } }).props.children);
  return "";
}

export function questionCount(md: string): number {
  return md.match(/^### /gm)?.length ?? 0;
}

// The home page's short FAQ. Each question is a heading in docs/FAQ.md, so its "More" link lands on the full answer.
export interface FaqHighlight {
  question: string;
  answer: string;
}

export const FAQ_HIGHLIGHTS: FaqHighlight[] = [
  {
    question: "What is Weft?",
    answer:
      "A desktop kanban board for AI coding agents. Every card is a live Claude Code or puku-cli thread working in one of your projects, with a browser pane you and the threads share and a copilot that runs the board.",
  },
  {
    question: "How is it different from just opening several terminals?",
    answer:
      "Every thread sits in Running, Needs you, Review or Done, so one look tells you which one is waiting on you. Threads show you the app in the pane, hand you a review tour, and keep out of each other's way in a shared folder.",
  },
  {
    question: "Do I need a Claude subscription?",
    answer:
      "For Claude Code threads, yes: they run on your own Claude login, as in a terminal. puku-cli threads can run on the Puku trial with no Puku account.",
  },
  {
    question: "Can a thread see my secrets?",
    answer:
      "No. Keys live in an encrypted vault on your Mac. Threads only get names, and use the values behind Touch ID to fill a field, run a command or push to Vercel.",
  },
  {
    question: "Does it work on Windows or Linux?",
    answer: "Not yet. Weft is a Mac app, and the release build is for Apple silicon.",
  },
  {
    question: "How much does Weft cost?",
    answer:
      "The app is free. Pro, $20 a month per workspace, raises the Puku allowance and lets you share the workspace; Team is $9 per seat a month. Claude Code and Codex threads always run on your own plans.",
  },
];
