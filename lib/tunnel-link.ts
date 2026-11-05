import { SITE } from "./site";

// A tunnel's private address as the board takes it from a worker: only Weft's own /t/<id>, with a path after it at
// most. A worker writes its dev servers' addresses and dev.open's answer itself, so the board checks before the pane
// opens one: never a javascript: or file: URL, and never another site passed off as a tunnel (docs/architecture/tunnels.md#on-a-worker).
const ADDRESS = new RegExp(`^${SITE.replace(/[.]/g, "\\.")}/t/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:[/?#]\\S*)?$`, "i");

export const isTunnelAddress = (v: unknown): v is string => typeof v === "string" && v.length <= 500 && ADDRESS.test(v);
