// The "copy it to R2 after this response" hook a reader passes to resolveBlobUrls or readBlob: a blob served from
// Supabase because it wasn't in R2 yet gets copied once the response has gone (next/server `after`), so the next
// read is R2's. Needs the service key and R2's settings; without either it does nothing. docs/architecture/r2.md.
import { after } from "next/server";
import { r2Config } from "./r2";
import { mirrorShas } from "./r2-mirror";
import { serviceClient } from "./web-session";

export function queueMirror(orgId: string): (shas: string[] | string) => void {
  return (shas) => {
    const service = serviceClient();
    const r2 = r2Config();
    if (!service || !r2) return;
    const list = typeof shas === "string" ? [shas] : shas;
    if (!list.length) return;
    try {
      after(() => mirrorShas(service, r2, orgId, list));
    } catch {
      // Outside a request (a test, a script): the cron copies it instead.
    }
  };
}
