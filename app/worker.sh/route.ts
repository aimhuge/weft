// weft.zip/worker.sh: the Weft Worker's installer (install/worker.sh, docs/architecture/weft-worker.md), for
// `curl -fsSL https://weft.zip/worker.sh | sh -s -- <token>`. A redirect to the file on main, so the line Settings →
// Sync → Workers shows always fetches the current script; curl's -L follows it.
const WORKER_SCRIPT = "https://raw.githubusercontent.com/aimhuge/weft/main/install/worker.sh";

export function GET(): Response {
  return Response.redirect(WORKER_SCRIPT, 302);
}
