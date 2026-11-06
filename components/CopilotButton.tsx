import { copilotEnabled } from "@/lib/features";
import Icon from "./Icon";

// The top bar's Copilot toggle, lit while the copilot's lane is open, with a dot when the copilot needs you.
// Hidden while the copilot is flagged off (lib/features.ts).
export default function CopilotButton(props: { open: boolean; needsYou: boolean; title: string; onClick: () => void }) {
  if (!copilotEnabled()) return null;
  return (
    <button
      onClick={props.onClick}
      title={props.title}
      aria-label="Copilot"
      className={`relative flex items-center gap-1.5 rounded-md border p-1.5 ${props.open ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-ink hover:bg-sunken"}`}
    >
      <Icon name="sparkles" size={15} />
      {props.needsYou && (
        <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-warn" title="The copilot needs you" />
      )}
    </button>
  );
}
