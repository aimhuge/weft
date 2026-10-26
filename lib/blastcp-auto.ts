import { accountClient } from "./account";
import { syncBlastcpPlan } from "./blastcp-plan";
import { shell } from "./browser-tools";
import type { WeftConnect } from "./blastcp-view";

export type { WeftConnect };

// Connecting BlastCP with your Weft account (docs/architecture/blastcp.md): Electron main swaps the account's
// access token for a BlastCP sign-in (electron/blastcp.cjs connectWeft), so a Weft user gets a BlastCP account
// and the drawer is connected with no browser. It runs when you sign in to Weft, twice a day (a sign-in made
// this way renews in its last week), and from the drawer's button. The token goes to main over its
// token-guarded control server and nowhere else; supabase-js refreshes it here, so main never has to.

const CHECK_MS = 12 * 60 * 60_000;

async function accessToken(): Promise<string | null> {
  try {
    const { data } = await accountClient().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    // Accounts aren't set up in this build.
    return null;
  }
}

// force is the drawer's button: it connects even after Disconnect, and replaces a sign-in BlastCP refused.
export async function connectBlastcpWithWeft(force = false): Promise<WeftConnect> {
  if (!process.env.WEFT_SHELL_URL) return { state: "unavailable" };
  const token = await accessToken();
  if (!token) return { state: "signed-out" };
  return (await shell("/blastcp/connect-weft", { subjectToken: token, force })) as WeftConnect;
}

const g = globalThis as { __weftBlastcpAuto?: { stop: () => void } };

// Once per server process (from prewarm): on sign-in, then on a timer. Failures log a line and wait for the next try.
export function startBlastcpAuto(): () => void {
  if (g.__weftBlastcpAuto) return g.__weftBlastcpAuto.stop;
  // The plan nudge (lib/blastcp-plan.ts) rides the same beat: the exchange only syncs the plan when it runs.
  const run = () => {
    void connectBlastcpWithWeft().catch((err: unknown) => console.warn(`BlastCP via Weft: ${(err as Error).message}`));
    void syncBlastcpPlan();
  };
  let unsubscribe = () => {};
  try {
    // supabase-js warns against awaiting its calls inside this callback, so the swap runs after it.
    const { data } = accountClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") setTimeout(run, 0);
    });
    unsubscribe = () => data.subscription.unsubscribe();
  } catch {
    // Accounts aren't set up in this build: nothing to hear.
  }
  const timer = setInterval(run, CHECK_MS);
  timer.unref();
  run();
  const stop = () => {
    unsubscribe();
    clearInterval(timer);
    g.__weftBlastcpAuto = undefined;
  };
  g.__weftBlastcpAuto = { stop };
  return stop;
}
