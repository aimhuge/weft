"use client";

// The bottom of the board: the footer (the open or latest card's model, folder and limits) and, below it,
// the terminal drawer when it's open.
import type { footerFor } from "@/lib/board-derive";
import { NO_DRAG } from "@/lib/no-drag";
import { guarded } from "./guarded";

const BoardFooter = guarded(() => import("./BoardFooter"), { what: "footer" });
const TerminalDrawer = guarded(() => import("./TerminalDrawer"), { what: "terminal", className: "m-3" });

export interface BoardBottomProps {
  footer: ReturnType<typeof footerFor>;
  onHelp: () => void;
  terminal: { open: boolean; cwd: string; height: number; onHeight: (height: number) => void; onClose: () => void };
}

export default function BoardBottom({ footer, onHelp, terminal }: BoardBottomProps) {
  return (
    <>
      <BoardFooter stats={footer.stats} cwd={footer.cwd} backend={footer.backend} onHelp={onHelp} />
      {/* After the footer so an open card can stop just above it; z-40 keeps it over the card's backdrop. */}
      {terminal.open && (
        <div style={NO_DRAG} className="relative z-40">
          {/* Each folder has its own shell: a new folder starts a new drawer. */}
          <TerminalDrawer key={terminal.cwd} cwd={terminal.cwd} height={terminal.height} onHeight={terminal.onHeight} onClose={terminal.onClose} />
        </div>
      )}
    </>
  );
}
