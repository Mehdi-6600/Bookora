"use client";

import { useState } from "react";
import { AlertTriangle, Mail, X } from "lucide-react";
import {
  MANUAL_SEND_MAX_EVIDENCE,
  buildManualSentRequest,
  checkManualSendEvidence,
  manualSendEvidenceHint,
} from "@/lib/outreach/manual-send-evidence";
import type { Translate } from "@/components/outreach/recipient-review";

/**
 * Manual-send attestation prompt (critical fix F, UI half).
 *
 * The server contract for `action: "mark_manual_sent"` is:
 *
 *   • `confirmedByOperator: true` (a literal — an explicit operator decision),
 *   • `evidence`: 3–500 characters describing how and where the human contact
 *     happened,
 *   • and still: administrator verification, do-not-contact, opt-out, a
 *     non-withdrawn consent, an APPROVED invitation and the live kill switch.
 *
 * This dialog only collects those two inputs and hands the payload to the
 * caller. It cannot weaken the server checks, and it never marks anything as
 * delivered: an attestation is recorded as SENT.
 */

export type ManualSendPromptProps = {
  recipientName: string;
  t: Translate;
  busy?: boolean;
  /** Message returned by the server for the last attempt, shown verbatim. */
  error?: string | null;
  onSubmit: (payload: {
    action: "mark_manual_sent";
    confirmedByOperator: true;
    evidence: string;
  }) => void;
  onCancel: () => void;
};

export function ManualSendPrompt({
  recipientName,
  t,
  busy = false,
  error = null,
  onSubmit,
  onCancel,
}: ManualSendPromptProps) {
  const [evidence, setEvidence] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const check = checkManualSendEvidence(evidence);
  const hintKey = manualSendEvidenceHint(evidence);
  const canSubmit = check.ok && confirmed && !busy;

  function submit() {
    const request = buildManualSentRequest({ evidence, confirmed });
    if (!request.ok) return;
    onSubmit(request.payload);
  }

  return (
    <div
      data-testid="manual-send-prompt"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("manualSendTitle")}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-[#B8D4F5] p-5 shadow-elevated"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-extrabold text-[#1A1F36]">
            {t("manualSendTitle")}
          </h3>
          <button
            type="button"
            data-testid="manual-send-cancel-x"
            onClick={onCancel}
            disabled={busy}
            aria-label={t("close")}
            className="rounded-lg p-1 text-[#1A1F36]/60 hover:bg-white disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-2 text-xs font-bold text-[#1A1F36]">
          {t("manualSendFor", { name: recipientName })}
        </p>

        <ul className="mt-2 space-y-1 rounded-2xl bg-white/70 p-3 text-[11px] font-medium leading-5 text-[#1A1F36]/80">
          <li>• {t("manualSendNoMessage")}</li>
          <li>• {t("manualSendRecordedAsSent")}</li>
          <li>• {t("manualSendServerChecks")}</li>
        </ul>

        <label
          htmlFor="manual-send-evidence"
          className="mt-3 block text-[11px] font-bold uppercase tracking-wide text-[#1A1F36]/60"
        >
          {t("manualSendEvidenceLabel")}
        </label>
        <textarea
          id="manual-send-evidence"
          data-testid="manual-send-evidence"
          value={evidence}
          onChange={(event) => setEvidence(event.target.value)}
          dir="auto"
          maxLength={MANUAL_SEND_MAX_EVIDENCE}
          rows={3}
          disabled={busy}
          placeholder={t("manualSendEvidencePlaceholder")}
          aria-describedby="manual-send-evidence-help"
          className="mt-1 w-full rounded-2xl bg-white px-3 py-2.5 text-sm font-medium text-[#1A1F36] outline-none placeholder:text-[#1A1F36]/40 shadow-soft disabled:opacity-60"
        />
        <p
          id="manual-send-evidence-help"
          data-testid="manual-send-evidence-help"
          className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-[#1A1F36]/60"
        >
          <span className={hintKey ? "text-[#B4121F]" : undefined}>
            {hintKey ? t(hintKey) : t("manualSendEvidenceOk")}
          </span>
          <span dir="ltr">
            {evidence.trim().length}/{MANUAL_SEND_MAX_EVIDENCE}
          </span>
        </p>

        <label className="mt-3 flex items-start gap-2 rounded-2xl bg-white p-3 text-[11px] font-bold leading-5 text-[#1A1F36]">
          <input
            type="checkbox"
            data-testid="manual-send-confirm"
            checked={confirmed}
            disabled={busy}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span>{t("manualSendConfirm")}</span>
        </label>

        {error && (
          <p
            data-testid="manual-send-error"
            role="alert"
            className="mt-2 flex items-start gap-2 rounded-2xl bg-[#FF4D5E] px-3 py-2 text-[11px] font-bold leading-5 text-white"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            data-testid="manual-send-cancel"
            onClick={onCancel}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-bold text-[#1A1F36] shadow-soft disabled:opacity-50"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            data-testid="manual-send-submit"
            onClick={submit}
            disabled={!canSubmit}
            className="flex items-center justify-center gap-2 rounded-2xl bg-[#FCA311] px-4 py-2.5 text-sm font-bold text-white shadow-soft disabled:opacity-50"
          >
            <Mail className="h-4 w-4" />
            {busy ? t("loading") : t("markManualSent")}
          </button>
        </div>
      </div>
    </div>
  );
}
