// @weft/client: Weft's client core in plain TypeScript, for the desktop board, weft.zip and the phone app alike
// (docs/architecture/project-hosts.md#views, README.md beside this file). Nothing here may import the DOM, React,
// Next, Node built-ins or the app's lib/; tsconfig.json beside this file checks that.
export { COLUMNS, MODES, type Backend, type Column, type PermissionMode, type SkillInfo } from "./card";
export { bangCommand, isBang } from "./bang";
export { BLOB_REF_PREFIX, type BlobRef } from "./blob-ref";
export { clip, shortToolName, timeAgo } from "./text";
export { extractStatus, type BoardStatus, type StatusColumn } from "./status";
export type { DiffLine, EditPreview } from "./edit-preview";
export type { ElicitField, PendingElicitation, Question, QuestionReply, SecretAsk, ThreadItem, VaultEnvironment } from "./thread-items";
export { paneFor, paneFromUrl, screenPage, screenTopic, SCREEN_EVENT, type ScreenDevice, type SharePane } from "./pane";
export { followUrl, pageLabel, plain, showMinis, turnId, type Dot, type Mini, type Visit } from "./show-rail";
export { HOST_VERBS, isHostVerb, type HostVerb } from "./host-verbs";
export { readRefusal, writeRefusal } from "./file-policy";
export {
  messageCall,
  permissionCall,
  widens,
  type AnswerArgs,
  type CardPatch,
  type CardUpdateArgs,
  type MessageArgs,
  type MessageBody,
  type Pending,
  type PermissionBody,
} from "./host-calls";
export { hostRow, type CardTarget, type HostArgs, type HostCommandRow, type HostPayload } from "./host-row";
export { DEV_LOG_MAX, hostCommand, hostFailure, hostResult, isHostDone, readHostCommand, remoteRefusal, tailBytes, textArgOf, verbResult, type HostDone, type HostResult } from "./host-command";
export { fitSkills, jsonbBytes, readSkills, skillCache, SKILLS_BUDGET, SKILLS_FRESH_MS, type SkillCache, type SkillsOnWire } from "./skills-wire";
export { b64, unb64, type Sodium } from "./sodium-like";
export {
  APPROVAL_MAX_SKEW_MS,
  approvalMessage,
  canonicalAnswers,
  freshEnough,
  GRANT_SCOPES,
  readApprovalAuth,
  signApproval,
  verifyApproval,
  type ApprovalAuth,
  type ApprovalFields,
  type GrantScope,
} from "./approval-sig";
