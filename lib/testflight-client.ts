import { accountClient, SUPABASE_KEY } from "./account";
import { BASE } from "./billing-client";
import type { InviteAnswer, TestflightInfo } from "./testflight-types";

// The desktop's bridge to weft.zip's /api/testflight (docs/architecture/mobile.md#testflight): the public link the
// "Weft on your phone" prompt and Pair a phone show as a QR code, and the invite emailed to the signed-in account.
// The App Store Connect key lives on weft.zip only; this side just forwards the account's access token.

// Without a link there's nothing to show: null (no deployment, a network error) hides the prompt and the line.
export async function fetchTestflight(fetchImpl: typeof fetch = fetch): Promise<TestflightInfo | null> {
  try {
    const res = await fetchImpl(`${BASE}/api/testflight`);
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<TestflightInfo>;
    return typeof body.url === "string" ? { url: body.url, invites: body.invites === true } : null;
  } catch {
    return null;
  }
}

export async function requestInvite(fetchImpl: typeof fetch = fetch): Promise<InviteAnswer> {
  if (!SUPABASE_KEY) return { ok: false, error: "Sign in to your Weft account first." };
  const { data } = await accountClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "Sign in to your Weft account first." };
  let res: Response;
  try {
    res = await fetchImpl(`${BASE}/api/testflight`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  } catch (err) {
    return { ok: false, error: `Couldn't reach weft.zip: ${(err as Error).message}` };
  }
  const body = (await res.json().catch(() => ({}))) as Partial<InviteAnswer> & { error?: unknown };
  if (body.ok === true) return body as InviteAnswer;
  if (typeof body.error === "string") return { ok: false, error: body.error };
  return { ok: false, error: res.status === 404 ? "weft.zip can't send TestFlight invites yet." : `weft.zip answered ${res.status}.` };
}
