"use client";

import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import type { Translate } from "@/components/outreach/recipient-review";

/**
 * Shared operator-facing states (critical fix H).
 *
 * A failed read and an empty result are different things and must never look
 * the same: the empty state is written text inside the card, the failure is a
 * red, unmissable banner with a retry button, and both carry a `data-testid` so
 * the regression suites can tell them apart.
 */

export function LoadFailureNotice({
  title,
  message,
  onRetry,
  t,
  testId = "outreach-load-error",
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  t: Translate;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      role="alert"
      className="rounded-2xl border-2 border-[#FF4D5E] bg-[#FF4D5E]/10 p-3"
    >
      <p className="flex items-start gap-2 text-sm font-extrabold text-[#B4121F]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        {title ?? t("loadFailedTitle")}
      </p>
      <p className="mt-1 break-words text-xs font-bold leading-5 text-[#B4121F]">
        {message}
      </p>
      <p className="mt-1 text-[11px] font-medium leading-5 text-[#B4121F]/80">
        {t("loadFailedHelp")}
      </p>
      {onRetry && (
        <button
          type="button"
          data-testid={`${testId}-retry`}
          onClick={onRetry}
          className="mt-2 inline-flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-xs font-bold text-[#B4121F] shadow-soft"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("retry")}
        </button>
      )}
    </div>
  );
}

export function EmptyStateNotice({
  message,
  testId = "outreach-empty",
}: {
  message: string;
  testId?: string;
}) {
  return (
    <p
      data-testid={testId}
      className="rounded-2xl bg-white px-3 py-6 text-center text-sm font-medium text-[#1A1F36]/60 shadow-soft"
    >
      {message}
    </p>
  );
}

export function LoadingNotice({
  label,
  testId = "outreach-loading",
}: {
  label: string;
  testId?: string;
}) {
  return (
    <p
      data-testid={testId}
      className="flex items-center gap-2 rounded-2xl bg-white px-3 py-4 text-sm font-medium text-[#1A1F36]/60 shadow-soft"
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </p>
  );
}

/**
 * The explanation attached to a disabled control. It is rendered as text (not
 * only as a tooltip) so it survives touch screens, RTL layouts and screen
 * readers.
 */
export function DisabledReasonHint({
  reason,
  t,
  testId = "control-disabled-reason",
}: {
  reason: string | null;
  t: Translate;
  testId?: string;
}) {
  if (!reason) return null;
  return (
    <p
      data-testid={testId}
      className="basis-full rounded-xl bg-[#1A1F36]/5 px-3 py-2 text-[11px] font-bold leading-5 text-[#1A1F36]/70"
    >
      {t(reason)}
    </p>
  );
}

/** Banner shown while the outreach kill switch makes actions unsafe. */
export function SettingsPausedNotice({
  t,
  testId = "outreach-settings-paused",
}: {
  t: Translate;
  testId?: string;
}) {
  return (
    <p
      data-testid={testId}
      role="status"
      className="rounded-2xl border border-[#FF4D5E] bg-[#FF4D5E]/10 px-3 py-2 text-[11px] font-bold leading-5 text-[#B4121F]"
    >
      {t("settingsPausedNotice")}
    </p>
  );
}
