// Every card's host on weft.zip (docs/architecture/project-hosts.md, Views): the board there runs on no Mac, so a card
// is always another machine's, its Mac's inbox or its worker's daemon, whatever its folder says. The board puts this in
// front of every card (lib/project-host.ts setHostForEveryCard), so the desktop's own tile handlers, menus, archive,
// drag and thread header (lib/card-handlers-host.ts, components/use-board-menus.ts, lib/use-board-archive.ts, …) send
// their verbs as `host` rows (lib/cloud-host-acts.ts) without knowing they're on the web. What it can do is a worker
// card's on the desktop: its verbs and Send later, none of a Mac's own features, and the same trimmed menu.
import { remoteMenu } from "./card-menu-remote";
import type { CloudHostActs } from "./cloud-host-acts";
import type { FilesSource } from "./files-source";
import type { HostFeature, ProjectHost } from "./project-host";
import type { ReadProject } from "./project-reads";
import type { ThreadTransport } from "./thread-transport";
import type { ToolResultSource } from "./use-tool-result";

const WEB_FEATURES = new Set<HostFeature>(["schedule"]);

// No header badges or editor on weft.zip yet (H4's reads and files.* are the desktop's): `can` says so, and a caller
// that asks anyway is told why rather than sent to this Mac's routes, which a browser tab doesn't have.
const NO_FILES = "The editor isn't on weft.zip yet. Open the card in Weft.";
const refuse = () => Promise.reject(new Error(NO_FILES));
const noReads: ReadProject = () => Promise.reject(new Error("Project reads aren't on weft.zip yet."));
const noFiles: FilesSource = { read: refuse, stat: refuse, head: refuse, list: refuse, write: refuse, live: false };

export function webHost(acts: Pick<CloudHostActs, "act">, thread: ThreadTransport, tools: ToolResultSource): ProjectHost {
  return {
    kind: "cloud",
    thread,
    tools,
    read: noReads,
    files: noFiles,
    can: (feature) => WEB_FEATURES.has(feature),
    act: (verb, args) => {
      const { id, ...rest } = args as { id: string } & Record<string, unknown>;
      return acts.act(verb, id, rest);
    },
    menu: remoteMenu,
    // A browser tab holds no session line, so nothing is warmed ahead of a reply (a worker's warm is line-only).
    warm: () => {},
  };
}
