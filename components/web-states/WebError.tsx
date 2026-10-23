// The error boundary's face on weft.zip: a visitor's page (a profile, a shared card or app, a workspace) threw.
// The message is hidden in production builds anyway (React's #441), so it says what happened in plain words,
// offers Try again and the way home, and shows the digest to quote. The desktop board keeps its own copy
// (app/error.tsx), which talks about threads editing Weft.
"use client";

import Link from "next/link";
import { WebProblem } from "./WebProblem";

export function WebError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <WebProblem
      title="This page didn't load"
      code={error.digest}
      actions={
        <>
          <button type="button" className="wz-btnPrimary" onClick={retry}>
            Try again
          </button>
          <Link href="/">Go to weft.zip</Link>
        </>
      }
    >
      Something went wrong on our side while drawing it. Trying again usually works; if it keeps happening, the
      reference below helps us find it.
    </WebProblem>
  );
}
