// The question reply's sanitizer lives in @weft/client (packages/weft-client/src/question-reply.ts), so the permission
// route, the cloud-inbox answer command and the phone read a reply with the same rules.
export { readQuestionReply } from "@weft/client";
