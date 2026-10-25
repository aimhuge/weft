// The project menu's Re-seed Backlog: parks the project's starter cards again (lib/project-seed-run.ts),
// skipping what's already on the board, and says how many it added in its own label, so the menu gains no row.
import { useState } from "react";
import { api } from "@/lib/client";
import { plural } from "@/lib/project-bar";
import Icon from "./Icon";

export default function ReseedButton({ path, className }: { path: string; className: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function reseed() {
    setBusy(true);
    try {
      const { added } = await api.seedProject(path);
      setNote(added ? `Added ${plural(added, "card", "cards")}` : "Nothing new");
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={() => void reseed()} disabled={busy} className={className} title="Park a few starter cards from what Weft finds in this project">
      <Icon name="sparkles" size={14} className="text-muted" /> Re-seed Backlog
      {note && <span className="ml-auto text-[11px] text-faint">{note}</span>}
    </button>
  );
}
