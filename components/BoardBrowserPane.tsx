"use client";

// The standalone browser pane, on the left of the board between the rail and the columns while no card
// is open (an open card's pane lives in its workspace's `pane` column, components/OpenCard.tsx).
// StandaloneBrowserPane slides it in and out instead of popping it.
import type { BrowserState } from "@/lib/client";
import type { ThreadItem } from "@/lib/types";
import { guarded } from "./guarded";
import StandaloneBrowserPane from "./StandaloneBrowserPane";

const BrowserPane = guarded(() => import("./BrowserPane"), { what: "browser pane", className: "m-3 w-[360px] self-start" });
const ShowRail = guarded(() => import("./ShowRail"), { what: "show rail", className: "w-[72px] shrink-0" });

export interface BoardBrowserPaneProps {
  open: boolean;
  // Its visibility from before the New thread dialog, while that is restored (lib/use-new-thread-pane.ts); wins over open.
  held?: boolean | null;
  desktop: boolean;
  state: BrowserState;
  width: number;
  onWidth: (width: number) => void;
  // A dialog, sign-in or menu is over the board: the native page hides under it.
  obscured: boolean;
  onClose: () => void;
  items: ThreadItem[];
}

export default function BoardBrowserPane({ open, held, desktop, state, width, onWidth, obscured, onClose, items }: BoardBrowserPaneProps) {
  return (
    <StandaloneBrowserPane open={held ?? open} width={width}>
      {(sliding) => (
        <BrowserPane
          desktop={desktop}
          state={state}
          obscured={sliding || obscured}
          width={width}
          onWidth={onWidth}
          onClose={onClose}
          expanded={false}
          // No card is open while the pane stands alone, so its show rail has no card.
          rail={<ShowRail card={null} hidden={false} items={items} pageUrl={state.url} />}
        />
      )}
    </StandaloneBrowserPane>
  );
}
