// A review tour's local pages, sent up with the card's row (lib/card-rows.ts) like the card's own page. A step that
// names a file on the host (`/Users/me/.weft/show/tour.html#login`) means nothing on another machine: the board on the
// user's Mac, or weft.zip, would find no such file. Each one goes up through the blob store's uploadPage, the same
// upload mcp__browser__open_url makes on a worker (lib/worker-pane.ts), images and stylesheets included, and the row's
// step reads `blob:sha256:<hex>?query#anchor` instead, which stepUrl and the pane open as the uploaded copy. What the
// store may send is its own rule (a worker's workerMayUpload roots, home only, never a secret); a step it refuses, or a
// file that's gone, keeps its path. The host's own card keeps its paths.
import os from "node:os";
import { resolveLocalPath } from "./blob-paths";
import type { BlobStore } from "./cloud-sync-types";
import { stepUrl } from "./review";
import type { Card, ReviewPlan, ReviewStep } from "./types";

type Uploads = Pick<BlobStore, "upload" | "uploadPage">;

// The file a step's file:// address names and the ?query#anchor after it. stepUrl encodes a literal ? or # in the
// file name, so the first bare one starts the suffix; its encodeURI output always decodes.
function splitFileUrl(url: string): { file: string; suffix: string } | null {
  if (!url.startsWith("file://")) return null;
  const at = url.slice(7).search(/[?#]/);
  const head = at < 0 ? url.slice(7) : url.slice(7, 7 + at);
  return { file: decodeURIComponent(head), suffix: at < 0 ? "" : url.slice(7 + at) };
}

async function uploadedStep(review: ReviewPlan, step: ReviewStep, blobs: Uploads, orgId: string, home: string): Promise<ReviewStep> {
  const url = stepUrl(review, step);
  const target = url ? splitFileUrl(url) : null;
  const local = target && resolveLocalPath(target.file, home);
  const ref = local ? await (blobs.uploadPage ?? blobs.upload)(local, orgId) : null;
  return ref && target ? { ...step, path: `${ref}${target.suffix}` } : step;
}

export async function withUploadedTour(card: Card, blobs: Uploads, orgId: string, home = os.homedir()): Promise<Card> {
  const review = card.review;
  if (!review?.steps.length) return card;
  const steps = await Promise.all(review.steps.map((step) => uploadedStep(review, step, blobs, orgId, home)));
  if (steps.every((step, i) => step === review.steps[i])) return card;
  return { ...card, review: { ...review, steps } };
}
