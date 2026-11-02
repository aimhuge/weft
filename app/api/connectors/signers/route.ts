// /api/connectors/signers, on weft.zip: the Mac keys that may say yes to a connector (lib/connector-signers.ts,
// docs/architecture/connectors.md#who-may-say-yes-the-chain-of-trust). GET lists yours; POST registers this Mac's key
// (signed by it; untrusted until you open the link emailed to you, or a trusted Mac vouches for it); DELETE ?id= takes one's trust
// away, with the grants it signed and their tokens.
import { connectorRoute, jsonBody } from "@/lib/connector-route";
import { listSigners, registerSigner, revokeSigner } from "@/lib/connector-signers";
import { MintError } from "@/lib/connector-tokens";
import { requestMeta } from "@/lib/connector-signer-links";

export async function GET(req: Request) {
  return connectorRoute(req, async (deps, user) => ({ signers: await listSigners(deps, user.id) }));
}

export async function POST(req: Request) {
  const body = await jsonBody(req);
  return connectorRoute(req, async (deps, user) => ({ signer: await registerSigner(deps, user.id, body, requestMeta(req)) }));
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return connectorRoute(req, async (deps, user) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new MintError(400, "Name the Mac key.");
    return { ok: true, ...(await revokeSigner(deps, user.id, id)) };
  });
}
