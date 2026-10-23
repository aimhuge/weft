"use client";

import posthog from "posthog-js";
import { useEffect } from "react";
import { analyticsOn } from "@/lib/analytics";

// The root layout itself failed. This replaces the whole document, so it carries its own styles
// (globals.css doesn't reach it) and follows the OS light/dark setting.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    if (analyticsOn()) posthog.captureException(error);
  }, [error]);

  return (
    <html lang="en" style={{ colorScheme: "light dark" }}>
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: 32 }}>
        <title>Weft</title>
        <h1 style={{ fontSize: 16 }}>Weft failed to start</h1>
        <p style={{ fontSize: 13, opacity: 0.7 }}>A thread may be partway through editing Weft. Your cards and threads are safe in ~/.weft.</p>
        <pre style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{error.message || String(error)}</pre>
        <button onClick={retry}>Try again</button> <button onClick={() => window.location.reload()}>Reload window</button>
      </body>
    </html>
  );
}
