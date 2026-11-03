"use client";

// The weft.zip pane's sealed pages (lib/web-blob-open.ts): a paired browser opens a page sealed with the workspace key
// itself and frames it through srcdoc; everyone else frames the page route as before, which draws a sealed page's 🔒.
// "checking" while a paired browser looks, so ciphertext never flashes in the frame.
import { useEffect, useState } from "react";
import type { SharePane } from "@/lib/share-types";
import { openSealedPage, type SealedPage } from "@/lib/web-blob-open";
import { webKeyring, webSodium } from "@/lib/web-sync-key";

export function useSealedPage(orgId: string | null, pane: SharePane | null): SealedPage | "checking" | null {
  const sha = orgId && pane?.kind === "blob" ? pane.ref.replace(/^blob:sha256:/, "") : null;
  const keyed = webKeyring().size > 0;
  const [got, setGot] = useState<{ sha: string; page: SealedPage | null } | null>(null);
  useEffect(() => {
    const s = webSodium();
    if (!orgId || !sha || !s || !keyed) return;
    let live = true;
    let url: string | null = null;
    void openSealedPage(orgId, sha, { s, ring: webKeyring() }).then((page) => {
      if (page?.kind === "file") url = page.url;
      if (live) setGot({ sha, page });
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [orgId, sha, keyed]);
  if (!sha || !keyed) return null;
  return got?.sha === sha ? got.page : "checking";
}
