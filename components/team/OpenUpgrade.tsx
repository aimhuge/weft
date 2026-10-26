"use client";

import { useEffect } from "react";
import { openUpgrade } from "@/lib/use-upgrade";

// Opens the workspace's upgrade dialog once, on arrival: the billing page renders it when the visitor came from a
// pricing card's link (/<slug>/billing?plan=pro, lib/billing/plan-link.ts), so Checkout is one click away.
export default function OpenUpgrade() {
  useEffect(() => {
    openUpgrade("plan");
  }, []);
  return null;
}
