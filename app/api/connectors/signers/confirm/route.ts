// /api/connectors/signers/confirm#id=&t=, on weft.zip: the link emailed when a Mac key is added. GET shows one button;
// its POST trusts the key, once, within a day (lib/connector-signer-links.ts confirmByLink). No session needed: the
// one-time token, sent only to the account's own address, is the proof.
import { connection } from "next/server";
import { donePage, linkPage } from "@/lib/connector-connect";
import { connectorDeps } from "@/lib/connector-deps";
import { confirmByLink } from "@/lib/connector-signer-links";

const PATH = "/api/connectors/signers/confirm";

export async function GET() {
  await connection();
  return linkPage("Confirm this Mac key?", "Confirm only if you just set Weft up on a Mac of yours. It will be able to approve GitHub on your workers.", PATH, "Confirm this Mac key");
}

export async function POST(req: Request) {
  await connection();
  const deps = connectorDeps();
  if (!deps) return donePage("Not set up yet", "GitHub connectors aren't set up on this server yet.");
  const form = await req.formData().catch(() => null);
  try {
    await confirmByLink(deps, form?.get("id"), form?.get("t"));
    return donePage("Mac key confirmed", "That Mac can now approve connectors for your Weft account. You can close this tab.");
  } catch (err) {
    return donePage("Not confirmed", (err as Error).message);
  }
}
