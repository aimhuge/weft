// The board's side of a session line's `host` channel (lib/session-line.ts): numbered calls, matched to their replies
// in order. A call made while the channel is down is never sent (LineDown, so the caller takes the relay); one sent and
// then cut off is LineLost, which the caller must not resend on the relay, since the worker may have run it.
import { readHostReply } from "./host-line-protocol";
import type { HostResult } from "./host-command";

// Longer than any verb but a slow start: a reply that never comes means the line is gone, not that the verb is slow.
export const CALL_MS = 30_000;

export class LineDown extends Error {
  constructor() {
    super("The line to this worker isn't open.");
  }
}

export class LineLost extends Error {
  constructor() {
    super("The line to your worker dropped before it answered. Check the card before you try again.");
  }
}

interface Pending {
  resolve: (result: HostResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createCalls(callMs = CALL_MS) {
  let next = 1;
  const pending = new Map<number, Pending>();

  function settle(id: number, fn: (p: Pending) => void) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    fn(p);
  }

  return {
    // send is null while the channel is down.
    call(send: ((text: string) => void) | null, verb: string, args: Record<string, unknown>): Promise<HostResult> {
      if (!send) return Promise.reject(new LineDown());
      const id = next++;
      return new Promise<HostResult>((resolve, reject) => {
        const timer = setTimeout(() => settle(id, (p) => p.reject(new LineLost())), callMs);
        pending.set(id, { resolve, reject, timer });
        try {
          send(JSON.stringify({ id, verb, args }));
        } catch {
          // A channel that closed between the check and the send never carried it.
          settle(id, (p) => p.reject(new LineDown()));
        }
      });
    },
    // A reply off the channel; anything unreadable or unknown is dropped.
    reply(raw: string) {
      const reply = readHostReply(raw);
      if (!reply) return;
      settle(reply.id, (p) => (reply.ok ? p.resolve(reply.result) : p.reject(new Error(reply.error))));
    },
    // The line closed: every call still out may or may not have run.
    lost() {
      [...pending.keys()].forEach((id) => settle(id, (p) => p.reject(new LineLost())));
    },
    size: () => pending.size,
  };
}
