// Signed approvals from a paired phone: @weft/client's (packages/weft-client/src/approval-sig.ts), the message the
// phone signs and the Mac checks, so the two build the same bytes (docs/architecture/mobile-security.md).
export {
  APPROVAL_MAX_SKEW_MS,
  approvalMessage,
  canonicalAnswers,
  freshEnough,
  readApprovalAuth,
  signApproval,
  verifyApproval,
  type ApprovalAuth,
  type ApprovalFields,
} from "@weft/client";
