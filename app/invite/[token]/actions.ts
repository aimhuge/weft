"use server";

// The single action behind /invite/[token]. The page renders a "Join <org>"
// form; the form posts to this, the action calls acceptInvite through the
// service client and setCurrentOrg so the visitor lands in the workspace they
// just joined, and redirects to /[orgSlug]/team?joined=1.
//
// Wrapped in a try/catch so a thrown accept (the package returns null on
// failure, but the upsert can throw on a race) lands back on the form with
// the message instead of bubbling a 500. setCurrentOrg is a no-op when the
// visitor was already a member — the package's acceptInvite is idempotent.
//
// The token is the only argument the form has, so we use the package's
// lookupInviteByToken at form-action time to fetch the orgId/orgSlug the
// redirect needs; that keeps the hidden field count at one and avoids
// trusting a client-supplied orgSlug.
import { acceptInvite, lookupInviteByToken, setCurrentOrg } from "@aimhuge/teams";
import { redirect } from "next/navigation";
import { serviceClient, webUser } from "@/lib/web-session";
import { syncTeamSeatsQuietly } from "@/lib/billing/seats";

// Read a single FormData field as a string (file entries would otherwise stringify to "[object Object]").
function formText(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

// The action takes a `prev` state because useActionState hands one in. We
// ignore it: the only return path that matters is the redirect on success.
export async function joinWorkspace(
  _prev: { ok: false; message: string },
  formData: FormData,
): Promise<{ ok: false; message: string }> {
  const token = formText(formData, "token").trim();
  if (!token) return { ok: false, message: "Missing invite token." };

  const service = serviceClient();
  if (!service) return { ok: false, message: "Invites aren't available on this deployment." };

  const user = await webUser();
  if (!user) return { ok: false, message: "Sign in first, then click the link again." };

  const lookup = await lookupInviteByToken(service, token).catch(() => null);
  if (!lookup) return { ok: false, message: "This invite link has expired or was revoked." };

  try {
    const result = await acceptInvite(service, lookup, user.id, user.email ?? "");
    if (!result) return { ok: false, message: "This invite link has expired or was revoked." };
    await setCurrentOrg(service, user.id, lookup.org.id);
    // On Team the person who just joined is a seat: the Stripe quantity follows (lib/billing/seats.ts).
    await syncTeamSeatsQuietly(service, lookup.org, user.email ?? null);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not accept this invite." };
  }

  // The redirect target is the org the invite points at — never a slug the
  // form could have forged. joined=1 lets the team page flash a "Welcome" line
  // the same way the SignedInPrompt does.
  redirect(`/${lookup.org.slug}/team?joined=1`);
}
