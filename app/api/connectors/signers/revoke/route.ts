// /api/connectors/signers/revoke#id=&t=, on weft.zip: the "not me" link emailed when a Mac key is added. GET shows one
// button; its POST revokes the key with the grants it signed and their tokens (lib/connector-signer-links.ts
// revokeByLink). No session needed, so it works when the session itself is what was stolen.
import { connection } from "next/server";
import { donePage, linkPage } from "@/lib/connector-connect";
import { connectorDeps } from "@/lib/connector-deps";
import { revokeByLink } from "@/lib/connector-signer-links";
import { revokeSigner } from "@/lib/connector-signers";

const PATH = "/api/connectors/signers/revoke";

export async function GET() {
  await connection();
  return linkPage("Revoke this Mac key?", "It will approve nothing more, and what it turned on is turned off. Then change your password, which signs Weft out everywhere.", PATH, "Revoke this key");
}

export async function POST(req: Request) {
  await connection();
  const deps = connectorDeps();
  if (!deps) return donePage("Not set up yet", "GitHub connectors aren't set up on this server yet.");
  const form = await req.formData().catch(() => null);
  try {
    await revokeByLink(deps, form?.get("id"), form?.get("t"), revokeSigner);
    return donePage("Mac key revoked", "That key can't approve anything now. Change your Weft password next, which signs out every session.");
  } catch (err) {
    return donePage("Not revoked", (err as Error).message);
  }
}
