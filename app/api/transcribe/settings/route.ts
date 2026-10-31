import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { readDictationPrefs, writeDictationPrefs } from "@/lib/dictation-prefs";
import { advancedStatus, warmIfAdvanced } from "@/lib/transcribe";
import { downloadModel, serverModel } from "@/lib/whisper-model";
import { stopServer } from "@/lib/whisper-server";

// Settings → General's Dictation card: the language, Advanced dictation, and its model download.
function view() {
  return { prefs: readDictationPrefs(), ...advancedStatus() };
}

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json(view());
}

// Turning Advanced dictation on fetches the model if there isn't one, then warms the server;
// turning it off lets go of the model's memory right away.
export async function PATCH(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const prefs = writeDictationPrefs((await req.json()) as Record<string, unknown>);
    if (!prefs.advanced) stopServer();
    else if (serverModel()) warmIfAdvanced();
    else void downloadModel().then(warmIfAdvanced);
    return Response.json(view());
  } catch (err) {
    return fail(err);
  }
}
