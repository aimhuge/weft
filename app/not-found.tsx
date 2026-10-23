// Every notFound() and unknown address on weft.zip: a profile that doesn't exist, a share link that was
// revoked, a mini app that was renamed, a mistyped URL. Without this file Next drew its own bare
// "This page could not be found." on a white page.
import type { Metadata } from "next";
import Link from "next/link";
import { WebProblem } from "@/components/web-states/WebProblem";

export const metadata: Metadata = {
  title: "Not found · Weft",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <WebProblem title="Nothing here" actions={<Link className="wz-btnPrimary" href="/">Go to weft.zip →</Link>}>
      This link doesn&apos;t lead anywhere. The profile, thread or app may have been renamed or stopped being
      shared, or the address has a typo.
    </WebProblem>
  );
}
