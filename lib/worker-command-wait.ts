// Waits for a command sent to a Weft Worker to finish, for the forms that want its real result on the board. A worker
// that doesn't claim it soon is probably offline, and the command stays queued, so that comes back as "pending".
export interface CommandResult {
  status: "pending" | "claimed" | "done" | "failed";
  error: string | null;
  // What the host wrote back for a host command (lib/host-command.ts HostResult); a read verb's answer rides in it.
  result?: unknown;
}

const EVERY_MS = 2_000;
// The worker polls every 3 s, so a minute unclaimed means it isn't there.
const UNCLAIMED_MS = 60_000;
// A little past the clone's own 10 minute timeout (lib/worker-paths.ts).
const CLAIMED_MS = 11 * 60_000;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface WaitOptions {
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
  // How often to ask (a pause, or one per ask for a backoff), and how long to wait for a claim and then for the
  // result: a form waits minutes, a card's own action on the board only seconds (lib/worker-acts.ts).
  every?: number | ((ask: number) => number);
  unclaimed?: number;
  claimed?: number;
}

export async function waitForCommand(
  read: () => Promise<CommandResult>,
  { sleep = pause, now = Date.now, every = EVERY_MS, unclaimed = UNCLAIMED_MS, claimed = CLAIMED_MS }: WaitOptions = {},
): Promise<CommandResult> {
  const started = now();
  let last: CommandResult = { status: "pending", error: null };
  for (let ask = 0; ; ask++) {
    // A read that fails is a blip: the command is still on its way, so keep the last answer and ask again.
    last = await read().catch(() => last);
    if (last.status === "done" || last.status === "failed") return last;
    if (now() - started > (last.status === "pending" ? unclaimed : claimed)) return last;
    await sleep(typeof every === "number" ? every : every(ask));
  }
}
