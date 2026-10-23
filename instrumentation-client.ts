import { startAnalytics } from "@/lib/analytics";

// PostHog and the data-track click listener, on weft.zip only: a local board never calls home (lib/analytics-gate.ts).
startAnalytics();
