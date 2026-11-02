// Every card's host on weft.zip (docs/architecture/project-hosts.md, Views): the board there runs on no Mac, so a card
// is always another machine's, its Mac's inbox or its worker's daemon, whatever its folder says. The board puts this in
// front of every card (lib/project-host.ts setHostForEveryCard), so the desktop's own tile handlers, menus, archive,
// drag and thread header (lib/card-handlers-host.ts, components/use-board-menus.ts, lib/use-board-archive.ts, …) send
// their verbs as `host` rows (lib/cloud-host-acts.ts) without knowing they're on the web. What it can do is a worker
// card's on the desktop: its verbs and Send later, none of a Mac's own features, and the same trimmed menu.
import { remoteMenu } from "./card-menu-remote";
import type { CloudHostActs } from "./cloud-host-acts";
import type { HostFeature, ProjectHost } from "./project-host";
import type { ThreadTransport } from "./thread-transport";
import type { ToolResultSource } from "./use-tool-result";

const WEB_FEATURES = new Set<HostFeature>(["schedule"]);

export function webHost(acts: Pick<CloudHostActs, "act">, thread: ThreadTransport, tools: ToolResultSource): ProjectHost {
  return {
    kind: "cloud",
    thread,
    tools,
    can: (feature) => WEB_FEATURES.has(feature),
    act: (verb, args) => {
      const { id, ...rest } = args as { id: string } & Record<string, unknown>;
      return acts.act(verb, id, rest);
    },
    menu: remoteMenu,
  };
}
