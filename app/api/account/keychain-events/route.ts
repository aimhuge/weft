import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { readKeychainRecord } from "@/lib/keychain-audit-record";

// The Keychain audit log as your Weft account keeps it (lib/keychain-audit-record.ts), for Settings → Security.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    return Response.json(await readKeychainRecord());
  } catch (err) {
    return fail(err, 500);
  }
}
