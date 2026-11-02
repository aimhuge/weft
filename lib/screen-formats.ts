// Which format a worker's live screen goes out in (lib/worker-screen.ts), agreed on the screen topic itself: each board
// that can draw WebP tracks { formats } in the topic's Presence (lib/use-screen-stream.ts), and the worker sends WebP
// only while at least one board is there and every board there said it takes it. A board too old to announce says
// nothing, so it gets JPEG only when it watches alone; beside a new board it gets WebP and stays blank until it updates.
// Free of Node imports, for the board.

export type FrameType = "webp" | "jpeg";

// What this board's <img> draws.
export const BOARD_FORMATS: FrameType[] = ["webp", "jpeg"];

const takesWebp = (meta: unknown) => {
  const formats = (meta as { formats?: unknown } | null)?.formats;
  return Array.isArray(formats) && formats.includes("webp");
};

// From the topic's presenceState: JPEG when nobody has said anything, or anyone there can't take WebP.
export function agreedType(state: Record<string, unknown[]>): FrameType {
  const metas = Object.values(state).flat();
  return metas.length > 0 && metas.every(takesWebp) ? "webp" : "jpeg";
}
