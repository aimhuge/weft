// The `host` command's row builder and readers live in @weft/client (packages/weft-client/src/host-command.ts), so
// weft.zip, the phone and every host build and read the same row.
export {
  hostCommand,
  hostFailure,
  hostResult,
  isHostDone,
  readHostCommand,
  remoteRefusal,
  textArgOf,
  verbResult,
  type CardTarget,
  type HostArgs,
  type HostCommandRow,
  type HostDone,
  type HostPayload,
  type HostResult,
} from "@weft/client";
