"use client";

import type { WelcomeProject } from "@/lib/welcome-preview";
import { PrintSheetOffer } from "./PrintShortcutSheet";

// The welcome's last screen (components/WelcomeDialog.tsx draws the frame and the Start button): your first thread,
// in a project you brought in, with starters for someone who doesn't know what to ask yet. What happens next is a
// real screenshot of an open card, not a drawing.

export const STARTERS = [
  { icon: "🗺", label: "Tour this codebase", text: "Give me a tour of this codebase: what it does, how it's laid out, and where to start." },
  { icon: "🐛", label: "Fix a bug", text: "Find one real bug in this project and fix it." },
  { icon: "✅", label: "Add tests", text: "Add tests where they're missing most." },
  { icon: "🚀", label: "Run it locally", text: "Get this project running locally and show it to me in the browser pane." },
];

export function FirstThreadStep({
  folders,
  cwd,
  setCwd,
  prompt,
  setPrompt,
  cliLabel,
}: {
  folders: WelcomeProject[];
  cwd: string;
  setCwd: (cwd: string) => void;
  prompt: string;
  setPrompt: (text: string) => void;
  cliLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-[18px] font-semibold text-ink">Start your first thread</h2>
        <p className="text-[12.5px] text-muted">It runs on {cliLabel} in the folder you pick. Its card lands in Running and the browser pane shows its work.</p>
      </div>
      <label className="flex items-center gap-2 text-[12.5px] text-muted">
        In
        <select value={cwd} onChange={(e) => setCwd(e.target.value)} className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2 py-1 text-ink">
          {folders.map((p) => (
            <option key={p.cwd} value={p.cwd}>
              {p.name} · {p.where}
            </option>
          ))}
          <option value="">Another folder…</option>
        </select>
      </label>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        placeholder="Tell it what to build, fix or explain…"
        className="resize-none rounded-md border border-line bg-bg px-3 py-2 text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
      />
      <div className="flex flex-wrap gap-1.5">
        {STARTERS.map((s) => (
          <button
            key={s.icon}
            type="button"
            onClick={() => setPrompt(s.text)}
            className={`rounded-full border px-2.5 py-0.5 text-[11.5px] hover:bg-sunken ${prompt === s.text ? "border-accent text-ink" : "border-line text-muted"}`}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-line p-2">
        <img src="/brand/faq/tour-open-card.jpg" alt="An open card: the thread on the left, the browser pane on the right" className="h-[86px] w-[138px] shrink-0 rounded border border-line object-cover object-left-top" />
        <ul className="flex flex-col gap-0.5 text-[11.5px] text-muted">
          <li>
            🧵 <b className="text-ink">Running</b>: the thread works; start more any time with ⌘N.
          </li>
          <li>
            ✋ <b className="text-ink">Needs you</b>: it asks before anything risky.
          </li>
          <li>
            👀 <b className="text-ink">Review</b>: Weft walks you through the change in the pane.
          </li>
          <li>
            ✅ <b className="text-ink">Done</b>: commit, push, docs and tests.
          </li>
        </ul>
      </div>
      <PrintSheetOffer />
    </div>
  );
}
