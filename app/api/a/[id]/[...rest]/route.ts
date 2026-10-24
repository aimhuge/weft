// GET /api/a/<id>/<anything else> — a plain 404. A single-page share's relative asset (<img src="us.webp">)
// resolves here from the page route; Next's "Nothing here" page would come back as the image's body, which
// reads as a broken app. Folder shares serve their files under /v/<ver>/ (lib/app-share-frame.ts).
export function GET(): Response {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
