// A request for a Weft Cloud Worker, from the form under the home page's plans (components/home/CloudWorkers.tsx).
// A cloud worker is a Weft Worker we host, so a card runs with the laptop closed and no VPS of your own
// (docs/architecture/weft-worker.md). It isn't built yet: the form asks what people would run on one, and the answer
// goes the feedback dot's way (lib/feedback-send.ts), into the `feedback` table and the team's Slack.
import { collectFeedback, type FeedbackPayload } from "./feedback-send";

export const CLOUD_REQUEST_TITLE = "☁️ Cloud worker request";
export const MAX_USE = 2000;

export interface CloudWorkerRequest {
  use: string;
  email: string;
  name: string | null;
}

const field = (form: FormData, key: string, max: number) => {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The form, checked: what they'd use it for and an email to reach them are required; null when either is missing.
export function parseRequest(form: FormData): CloudWorkerRequest | null {
  const use = field(form, "use", MAX_USE);
  const email = field(form, "email", 200);
  if (!use || !email || !EMAIL.test(email)) return null;
  return { use, email, name: field(form, "name", 120) };
}

export function requestPayload(r: CloudWorkerRequest): FeedbackPayload {
  return {
    summary: { title: CLOUD_REQUEST_TITLE, body: `**What they'd use it for:**\n${r.use}` },
    messages: [],
    from: { name: r.name, email: r.email },
    version: null,
  };
}

// Where the browser goes back to: the page the form was on, at the anchor the card shows its answer by (`:target`,
// so the home page stays free of client JS). Only a same-origin referer counts; anything else goes to the home page.
export function backTo(req: Request, ok: boolean): URL {
  const here = new URL(req.url);
  let path = "/";
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const from = new URL(referer);
      if (from.origin === here.origin) path = from.pathname;
    } catch {
      path = "/";
    }
  }
  return new URL(`${path}#${ok ? "wz-cloudSent" : "wz-cloudFailed"}`, here.origin);
}

// The route's work: 303 back to the form either way, with the answer in the anchor.
export async function handleRequest(req: Request, collect: typeof collectFeedback = collectFeedback): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const parsed = form ? parseRequest(form) : null;
  const key = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const status = parsed ? await collect(requestPayload(parsed), key) : 400;
  return Response.redirect(backTo(req, status === 204), 303);
}
