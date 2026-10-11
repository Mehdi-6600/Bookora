/**
 * Manual-send evidence contract (critical fix F, UI half).
 *
 * `PATCH /api/admin/outreach/invitations/[id]` with
 * `action: "mark_manual_sent"` requires BOTH an explicit operator confirmation
 * (`confirmedByOperator: true`, a literal) and 3–500 characters of evidence
 * describing how and where the human contact happened. Without evidence the
 * server answers 400; without the confirmation it answers 409.
 *
 * The helpers below build exactly that request. They must never become an
 * alternative validation path: the server re-reads verification, do-not-contact,
 * opt-out, consent withdrawal, invitation state and the kill switch inside the
 * transaction that records the attestation, and it still refuses the request if
 * anything is wrong. Client-side checks exist only to keep the operator from
 * submitting something the server will reject.
 */

/** Mirrors `evidence: z.string().trim().min(3).max(500)` in the route. */
export const MANUAL_SEND_MIN_EVIDENCE = 3;
export const MANUAL_SEND_MAX_EVIDENCE = 500;

export type ManualSendEvidenceFailure =
  | "missing"
  | "too_short"
  | "too_long"
  | "not_confirmed";

export type ManualSendEvidenceCheck =
  | { ok: true; evidence: string }
  | { ok: false; reason: ManualSendEvidenceFailure };

/**
 * Validate the evidence text the way the server does: trim first, then require
 * 3–500 characters. A string of spaces is missing evidence, not valid evidence.
 */
export function checkManualSendEvidence(value: unknown): ManualSendEvidenceCheck {
  if (typeof value !== "string") return { ok: false, reason: "missing" };
  const evidence = value.trim();
  if (evidence.length === 0) return { ok: false, reason: "missing" };
  if (evidence.length < MANUAL_SEND_MIN_EVIDENCE) return { ok: false, reason: "too_short" };
  if (evidence.length > MANUAL_SEND_MAX_EVIDENCE) return { ok: false, reason: "too_long" };
  return { ok: true, evidence };
}

export type ManualSentPayload = {
  action: "mark_manual_sent";
  confirmedByOperator: true;
  evidence: string;
};

export type ManualSentRequest =
  | { ok: true; payload: ManualSentPayload }
  | { ok: false; reason: ManualSendEvidenceFailure };

/**
 * Build the request body for a manual-send attestation.
 *
 * `confirmedByOperator` is only ever the literal `true`, and it is only sent
 * when the operator actually confirmed in the UI. There is deliberately no way
 * to build this payload without evidence.
 */
export function buildManualSentRequest(input: {
  evidence: unknown;
  confirmed: boolean;
}): ManualSentRequest {
  const checked = checkManualSendEvidence(input.evidence);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  if (input.confirmed !== true) return { ok: false, reason: "not_confirmed" };
  return {
    ok: true,
    payload: {
      action: "mark_manual_sent",
      confirmedByOperator: true,
      evidence: checked.evidence,
    },
  };
}

/** Why the submit button is disabled, as an i18n key. */
export function manualSendEvidenceHint(value: unknown): string | null {
  const checked = checkManualSendEvidence(value);
  if (checked.ok) return null;
  switch (checked.reason) {
    case "too_short":
      return "manualEvidenceTooShort";
    case "too_long":
      return "manualEvidenceTooLong";
    case "missing":
    default:
      return "manualEvidenceMissing";
  }
}
