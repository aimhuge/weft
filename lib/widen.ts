// Signed widening's message and readers: @weft/client's (packages/weft-client/src/widen.ts), so the desktop, weft.zip's
// sign page, the phone and every host build the same bytes. The host's check is lib/widen-check.ts.
export {
  canonical,
  freshWiden,
  readWidenAuth,
  widenChangeOf,
  widenLabel,
  widenMessage,
  withoutWiden,
  WIDEN_MESSAGE_V,
  WIDEN_TTL_MS,
  type WidenAuth,
  type WidenChange,
  type WidenFields,
  type WidenVerb,
} from "@weft/client";
