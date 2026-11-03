import type { Metadata } from "next";
import DictationPill from "@/components/DictationPill";

export const metadata: Metadata = { title: "Dictation" };

// The floating dictation pill's page, loaded by electron/dictation-helper.cjs into its always-on-top window.
export default function DictatePage() {
  return <DictationPill />;
}
