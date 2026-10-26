"use client";
import { useState } from "react";
import type { TProbe } from "./tprobe-types";
export function TProbeClient() {
  const [v] = useState<TProbe | null>(null);
  return <span>{v ? v.x : "none"}</span>;
}
