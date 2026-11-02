// A project's address: the host that holds its checkout and the repo on it (docs/architecture/project-hosts.md#devices-and-records).
// The board keys projects on a path, so the address travels as one: a local project is its absolute folder on this Mac,
// a worker's is worker://<worker id>/<folder>. Every worker:// path is built and read here, so the wire format has one
// home. Imports nothing, so the daemon (jiti, no @/ alias) and the board can both load it.

export const WORKER_SCHEME = "worker://";

export type HostRef = { kind: "local" } | { kind: "worker"; id: string };

export interface ProjectAddress {
  host: HostRef;
  // The folder: an absolute path on this Mac, or a project name under a worker's work root.
  repo: string;
}

export const LOCAL_HOST: HostRef = { kind: "local" };

export const localAddress = (folder: string): ProjectAddress => ({ host: LOCAL_HOST, repo: folder });

export const workerAddress = (workerId: string, folder: string): ProjectAddress => ({ host: { kind: "worker", id: workerId }, repo: folder });

export const isWorkerPath = (path: string | null | undefined): path is string => Boolean(path?.startsWith(WORKER_SCHEME));

// The path the board and the cloud rows carry for an address.
export const formatProjectAddress = ({ host, repo }: ProjectAddress): string => (host.kind === "worker" ? `${WORKER_SCHEME}${host.id}/${repo}` : repo);

// The address a path names: a worker path needs both a worker id and a folder, anything else is a local folder. Null
// for an empty path or a worker path missing either half.
export function parseProjectAddress(path: string): ProjectAddress | null {
  if (!path) return null;
  if (!isWorkerPath(path)) return localAddress(path);
  const rest = path.slice(WORKER_SCHEME.length);
  const slash = rest.indexOf("/");
  if (slash < 1 || slash === rest.length - 1) return null;
  return workerAddress(rest.slice(0, slash), rest.slice(slash + 1));
}
