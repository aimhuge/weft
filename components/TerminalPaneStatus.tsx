"use client";

// The one line along a pane's foot: why its shell couldn't start (with a Try again), else how it exited. Never both,
// since a shell that never started has no exit to report, and the two used to draw over each other.
export default function PaneStatus({ error, exited, remote, onRestart }: { error: string | null; exited: number | null; remote: boolean; onRestart: () => void }) {
  if (error) {
    return (
      <p role="alert" className="absolute bottom-2 left-3 right-3 text-[12px] text-red-400">
        {remote ? error : `Couldn't start a shell: ${error}`}{" "}
        <button onClick={onRestart} className="text-zinc-300 hover:underline">
          Try again
        </button>
      </p>
    );
  }
  if (exited === null) return null;
  return (
    <button onClick={onRestart} className="absolute bottom-2 left-3 text-[12px] text-amber-400 hover:underline">
      Shell exited ({exited}). Restart
    </button>
  );
}
