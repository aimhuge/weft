// Waits for a command sent to a Weft Worker to finish, for the forms that want its real result on the board. A worker
// that doesn't claim it soon is probably offline, and the command stays queued, so that comes back as "pending".
export interface CommandResult {
  status: "pending" | "claimed" | "done" | "failed";
  error: string | null;
}

const EVERY_MS = 2_000;
// The worker polls every 3 s, so a minute unclaimed means it isn't there.
const UNCLAIMED_MS = 60_000;
// A little past the clone's own 10 minute timeout (lib/worker-paths.ts).
const CLAIMED_MS = 11 * 60_000;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForCommand(
  read: () => Promise<CommandResult>,
  { sleep = pause, now = Date.now }: { sleep?: (ms: number) => Promise<unknown>; now?: () => number } = {},
): Promise<CommandResult> {
  const started = now();
  let last: CommandResult = { status: "pending", error: null };
  for (;;) {
    // A read that fails is a blip: the command is still on its way, so keep the last answer and ask again.
    last = await read().catch(() => last);
    if (last.status === "done" || last.status === "failed") return last;
    if (now() - started > (last.status === "pending" ? UNCLAIMED_MS : CLAIMED_MS)) return last;
    await sleep(EVERY_MS);
  }
}
