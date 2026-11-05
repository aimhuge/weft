"use client";

import { useRegularMode } from "@/lib/use-regular-mode";

// Chrome that shows in Advanced mode and is stripped off in Regular (lib/board-prefs.ts).
export default function AdvancedOnly({ children }: { children: React.ReactNode }) {
  return useRegularMode() ? null : children;
}
