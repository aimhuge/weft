// @weft/client: Weft's client core in plain TypeScript, for the desktop board, weft.zip and the phone app alike
// (docs/architecture/project-hosts.md#views, README.md beside this file). Nothing here may import the DOM, React,
// Next, Node built-ins or the app's lib/; tsconfig.json beside this file checks that.
export { COLUMNS, MODES, type Backend, type Column, type Effort, type PermissionMode, type SkillInfo } from "./card";
export { bangCommand, isBang } from "./bang";
export { cleanTz, ownTimeZone, readClientHint, withClientHint, type ClientApp, type ClientHint } from "./client-hint";
export { BLOB_REF_PREFIX, type BlobRef } from "./blob-ref";
export { clip, shortToolName, timeAgo } from "./text";
export { extractStatus, type BoardStatus, type StatusColumn } from "./status";
export type { DiffLine, EditPreview } from "./edit-preview";
export type { ElicitField, PendingElicitation, Question, QuestionReply, SecretAsk, ThreadItem, VaultEnvironment } from "./thread-items";
export { paneFor, paneFromUrl, screenPage, screenTopic, SCREEN_EVENT, type ScreenDevice, type SharePane } from "./pane";
export { followUrl, pageLabel, plain, showMinis, turnId, type Dot, type Mini, type Visit } from "./show-rail";
export { HOST_VERBS, isHostLevelVerb, isHostVerb, isListVerb, type CardVerb, type HostLevelVerb, type HostVerb, type ListVerb } from "./host-verbs";
export { readRefusal, writeRefusal } from "./file-policy";
export {
  ACCOUNT_SETTINGS,
  GOOSE_SETTINGS,
  HOST_SETTINGS,
  foreignSetting,
  gooseFieldsOf,
  pickSettings,
  withoutGoose,
  type AccountSetting,
  type GooseSetting,
  type GooseSettings,
  type HostSetting,
  type HostSettings,
} from "./host-settings";
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
export { hostLevelRow, hostRow, type CardTarget, type HostArgs, type HostCommandRow, type HostPayload, type HostTarget } from "./host-row";
export { DEV_LOG_MAX, hostCommand, hostFailure, hostResult, isHostDone, readHostCommand, remoteRefusal, tailBytes, textArgOf, verbResult, type HostDone, type HostResult } from "./host-command";
export { listRefusal, cronCreateRefusal, CRON_CREATE_FIELDS, CRON_PATCH_FIELDS, HOOK_PATCH_FIELDS } from "./list-policy";
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
export {
  canonical,
  createTerms,
  freshWiden,
  readWidenAuth,
  widenArgsOf,
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
} from "./widen";
export {
  applyThreadEvent,
  findToolResult,
  mergeOlderPage,
  pageThread,
  trimToolResult,
  THREAD_PAGE_SIZE,
  TOOL_RESULT_INLINE_MAX,
  type PageOptions,
  type ThreadPage,
} from "./thread-page";
export { cutAt, pageFromItemRows, pageUpdateWith, type CloudItemChange, type CloudItemRow, type IsItem, type OpenItem } from "./cloud-thread-page";
export {
  activeAt,
  backlogSorter,
  cardLooksLikeError,
  cardLooksLikeSessionLimit,
  groupByColumn,
  headerCounts,
  listGroups,
  listRows,
  NO_REVIEW_FILTER,
  reviewFilterCounts,
  reviewKeeps,
  shownColumn,
  SORTERS,
  summarizeProjects,
  topMatches,
  type BoardCard,
  type BoardProject,
  type BoardView,
  type FilterMatch,
  type ListGroup,
  type ListRow,
  type ProjectSummary,
  type ProjectWorker,
  type ReviewFilter,
  type ReviewFilterKey,
  type SortKey,
  type WorkerProjectStatus,
} from "./board-group";
export { readQuestionReply } from "./question-reply";
export type { Sealed } from "./sealed";
export type { PasskeyAuth } from "./passkey-auth";
export {
  answerBody,
  answerCommand,
  commandText,
  isNewCardMode,
  isOpenCommand,
  NEW_CARD_MODES,
  newCardCommand,
  replyBody,
  replyCommand,
  stopBody,
  stopCommand,
  type AnswerPayload,
  type ClonePayload,
  type CloudCommandKind,
  type CloudCommandRow,
  type CloudCommandStatus,
  type InputPayload,
  type LinePayload,
  type LoginPayload,
  type ModePayload,
  type NewCardForm,
  type NewCardMode,
  type NewCardPayload,
  type NewCommand,
  type PinPayload,
  type QaPayload,
  type ReplyPayload,
  type StopPayload,
  type UpdatePayload,
} from "./cloud-commands";
export { pendingView, type PendingPermission, type PromptReason } from "./pending";
export { pendingItem, unsent, type PendingSend } from "./pending-sends";
export { findableText, findCount, matchThread, plainMarkdown, spotAt, totalHits, type FindMatch, type FindSpot } from "./thread-find";
export type { MediaKind, UploadedAttachment } from "./attachment";
export { mergePage, SHELL_ELSEWHERE, type PageUpdate, type ThreadTransport } from "./transport";
export { answerKeys, rawX25519, sealedOf, sealTo, spkiX25519, type AnswerKeys, type SealCrypto, type SealedAnswer, type SealSodium, type SubtleLike } from "./seal";
export { LINE_CHANNELS, LINE_PURPOSE, lineOpener, linePlaintext, lineRow, lineTopic, type IceServer, type LineOffer, type LineOpenerDeps, type LineRow } from "./line-offer";
export { gathered, GATHER_MS, offerLine, openLine, STUN, type Listen, type LinePeer, type OfferDeps, type OfferPeer, type OpenedLine, type SdpInit, type OpenLineDeps } from "./line-open";
