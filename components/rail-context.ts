import type { Card } from "@/lib/types";

// What the left rail hands every drawer behind it (🔐, 🪝, ▲, Supabase, Cloudflare, BlastCP, GitHub, Slack,
// skills, 🖥 Services): the board's project and cards, and the few board actions a drawer can take.
export interface RailContext {
  // The board's selected project folder, or null for all of them.
  project: string | null;
  // The folders whose vaults 🔐 shows: every project on the board (its filter starts on project).
  folders: string[];
  cards: Card[];
  // Shows a page (a deploy) in the board's browser pane.
  onOpenUrl: (url: string) => void;
  // Opens a card's thread (the Supabase drawer's link from a migration to the card that wrote it).
  onOpenCard: (card: Card) => void;
  // Starts a card in a folder (a drawer's helper card, like Supabase's Migrate); rejects when that fails.
  onStartCard: (cwd: string, prompt: string, title: string) => Promise<string | undefined>;
  notify: (err: unknown) => void;
}
