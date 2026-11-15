"use client";

// Simple mode's pieces under its switch in Settings → General (docs/architecture/simple-mode.md): one small
// checkbox each, so you can keep a piece in either mode. Ticking a box back to what the mode gives clears the
// piece's own cookie, so it follows the mode again.
import { boardMode } from "@/lib/board-prefs";
import { setSimplePiece, type SimplePiece } from "@/lib/simple-mode";
import { useUiText } from "@/lib/ui-language";
import { useSimplePiece } from "@/lib/use-simple-piece";

const PIECES: { piece: SimplePiece; label: string }[] = [
  { piece: "pane-full", label: "Full-page pane" },
  { piece: "fold-turn-steps", label: "Fold a turn's steps" },
  { piece: "one-box-new-card", label: "One-box new card" },
  { piece: "three-piles", label: "Three piles" },
];

function PieceBox({ piece, label }: { piece: SimplePiece; label: string }) {
  const t = useUiText();
  const on = useSimplePiece(piece);
  return (
    <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          const next = e.target.checked;
          setSimplePiece(piece, next === (boardMode() === "regular") ? undefined : next);
        }}
        className="accent-accent"
      />
      {t(label)}
    </label>
  );
}

export default function SimplePieces() {
  return (
    <div className="-mt-1 flex flex-wrap gap-x-4 gap-y-1">
      {PIECES.map((p) => (
        <PieceBox key={p.piece} {...p} />
      ))}
    </div>
  );
}
