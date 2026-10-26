import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { addGogAccount, cancelGogAdd, gogStatus, removeGogAccount, setGogCredentials } from "@/lib/gog";

// Settings → Connectors → Google Workspace: gog's version, OAuth client and signed-in accounts.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    return Response.json(await gogStatus());
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const text = (key: string) => (typeof body[key] === "string" ? body[key].trim() : "");
    switch (body.action) {
      case "credentials":
        await setGogCredentials(text("json"));
        break;
      case "add":
        await addGogAccount(text("email"), { readonly: body.readonly === true });
        break;
      case "cancel":
        cancelGogAdd();
        break;
      case "remove":
        await removeGogAccount(text("email"), text("client") || undefined);
        break;
      default:
        throw new Error("Unknown action. Use credentials, add, cancel or remove.");
    }
    return Response.json(await gogStatus());
  } catch (err) {
    return fail(err);
  }
}
