// The BOARD STATUS line's parser lives in @weft/client (packages/weft-client/src/status.ts), so the board, weft.zip
// and the phone read a thread's status the same way.
export { extractStatus, type BoardStatus, type StatusColumn } from "@weft/client";
