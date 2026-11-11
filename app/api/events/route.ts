import { connection } from "next/server";
import { trackActivity } from "@/lib/activity";
import { subscribe } from "@/lib/bus";
import { elevated, guard } from "@/lib/guard";
import { startLimitPoll } from "@/lib/limit-poll";

// Server-sent events: every card change and thread update, as it happens. The board opens this first,
// so it also starts the activity log (lib/activity.ts) following the board.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  const canSeeCopilotLogin = !elevated(req, { write: false });
  await connection();
  try {
    trackActivity();
    startLimitPoll();
  } catch (err) {
    console.warn("Couldn't start the activity log", err);
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = subscribe((event) => {
        if (event.type === "login" && event.login.backend === "github-copilot" && !canSeeCopilotLogin) return;
        write(`data: ${JSON.stringify(event)}\n\n`);
      });
      const ping = setInterval(() => write(": ping\n\n"), 15_000);
      cleanup = () => {
        unsubscribe();
        clearInterval(ping);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
      write(": connected\n\n");
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
