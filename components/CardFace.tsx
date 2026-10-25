"use client";

// A card's face at prompt size: its emoji, else its thumbnail, else its title's first letter, in a small tile.
// The claim-clash prompt shows the holder's and this thread's side by side (components/PermissionInput.tsx),
// and You first the waiting card's (components/YouFirst.tsx), so who is in whose way reads at a glance.
export interface Face {
  title: string;
  emoji?: string;
  thumb?: string;
}

// The emoji reads at this size where a screenshot thumbnail doesn't, so it wins; the thumbnail stands in for a
// card with no emoji yet.
export default function CardFace({ face, tip }: { face: Face; tip: string }) {
  const box = "inline-grid size-5 shrink-0 place-items-center overflow-hidden rounded bg-sunken text-[13px] leading-none";
  if (!face.emoji && face.thumb) return <img src={face.thumb} alt={face.title} title={tip} className={`${box} border border-line object-cover object-left-top`} />;
  return (
    <span role="img" aria-label={face.title} title={tip} className={`${box} ${face.emoji ? "" : "text-[11px] font-semibold text-faint"}`}>
      {face.emoji ?? (face.title.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
