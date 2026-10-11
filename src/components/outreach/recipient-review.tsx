"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ClipboardCopy, Info } from "lucide-react";
import {
  DEFAULT_REVIEW_PAGE_SIZE,
  REVIEW_FILTERS,
  formatCheckedAt,
  hasMessagePreview,
  paginateRecipients,
  recipientChannel,
  recipientConsentState,
  recipientQuotaState,
  recipientReasonText,
  recipientReviewCounts,
  recipientSuppressionState,
  recipientVerificationState,
  filterRecipients,
  normalizePageSize,
  type ReviewFilter,
  type ReviewRecipient,
} from "@/lib/outreach/recipient-review";

/**
 * Full recipient review (critical fix E).
 *
 * `planCampaign()` returns EVERY matched recipient — blocked ones included —
 * with its verification, consent, suppression and quota state, the machine
 * reason code, a plain-language reason in three languages and the exact message
 * that would go out. This component renders all of it, paginated and scrollable,
 * so an administrator can judge each recipient before approving anything.
 *
 * It is deliberately free of data fetching, of Prisma and of next-intl: the
 * panel passes the plan, the locale and a translate function in, which keeps the
 * whole thing renderable in unit tests (see the UI regression suites).
 */

/**
 * A translate function. It is intentionally typed loosely: next-intl's `t` and
 * the test double used by the render suites both satisfy it, and neither the
 * component nor the tests need the message catalogue's literal key types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Translate = (key: string, values?: any) => string;

export type RecipientPlanLike = {
  recipients?: ReviewRecipient[] | null;
  warnings?: string[] | null;
  settingsPaused?: boolean;
  generatedAt?: Date | string | null;
  sendLimit?: number;
  dailyQuota?: number;
};

export type RecipientReviewProps = {
  plan: RecipientPlanLike;
  locale: string;
  t: Translate;
  /** "rtl" for Persian/Arabic. Mirrors the locale layout's direction. */
  dir?: "rtl" | "ltr";
  cityLabel?: (code: string | null) => string;
  segmentLabel?: (segment: string | null) => string;
  onCopy?: (text: string) => void;
  /** Default page size; must be one of the offered sizes. */
  initialPageSize?: number;
};

const FILTER_LABEL_KEYS: Record<ReviewFilter, string> = {
  all: "reviewFilterAll",
  eligible: "reviewFilterEligible",
  manual_only: "reviewFilterManualOnly",
  blocked: "reviewFilterBlocked",
  held_over: "reviewFilterHeldOver",
};

export function RecipientReview({
  plan,
  locale,
  t,
  dir = "ltr",
  cityLabel,
  segmentLabel,
  onCopy,
  initialPageSize = DEFAULT_REVIEW_PAGE_SIZE,
}: RecipientReviewProps) {
  const recipients = useMemo(
    () => (Array.isArray(plan?.recipients) ? plan.recipients : []),
    [plan?.recipients]
  );
  const counts = useMemo(() => recipientReviewCounts(recipients), [recipients]);

  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => normalizePageSize(initialPageSize));

  const visible = useMemo(
    () => filterRecipients(recipients, filter),
    [recipients, filter]
  );
  const view = useMemo(
    () => paginateRecipients(visible, page, pageSize),
    [visible, page, pageSize]
  );

  const warnings = Array.isArray(plan?.warnings) ? plan.warnings : [];

  function chooseFilter(next: ReviewFilter) {
    setFilter(next);
    setPage(1);
  }

  function choosePageSize(next: number) {
    setPageSize(normalizePageSize(next));
    setPage(1);
  }

  return (
    <section
      data-testid="recipient-review"
      dir={dir}
      className="mt-3 rounded-2xl bg-white p-3 shadow-soft sm:p-4"
      aria-label={t("recipientReviewTitle")}
    >
      <header className="space-y-1">
        <h3 className="text-sm font-extrabold text-[#1A1F36]">
          {t("recipientReviewTitle")}
        </h3>
        <p className="text-[11px] font-medium leading-5 text-[#1A1F36]/60">
          {t("recipientReviewHelp")}
        </p>
        <p
          data-testid="review-generated-at"
          dir="ltr"
          className="text-[11px] font-bold text-[#1A1F36]/50"
        >
          {t("reviewEvaluatedAt")}: {formatCheckedAt(plan?.generatedAt ?? null)}
        </p>
      </header>

      {plan?.settingsPaused && (
        <p
          data-testid="review-settings-paused"
          className="mt-2 rounded-xl bg-[#FF4D5E]/10 px-3 py-2 text-[11px] font-bold leading-5 text-[#FF4D5E]"
        >
          {t("reviewSettingsPaused")}
        </p>
      )}

      {warnings.map((warning, index) => (
        <p
          key={`${warning}-${index}`}
          data-testid="review-warning"
          className="mt-2 rounded-xl bg-[#FCA311]/15 px-3 py-2 text-[11px] font-bold leading-5 text-[#B45309]"
        >
          ⚠️ {warning}
        </p>
      ))}

      <dl
        data-testid="review-counts"
        className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
      >
        <CountCell testId="review-count-total" label={t("reviewCountTotal")} value={counts.total} />
        <CountCell testId="review-count-eligible" label={t("eligible")} value={counts.eligible} />
        <CountCell testId="review-count-manual-only" label={t("manualOnly")} value={counts.manualOnly} />
        <CountCell testId="review-count-blocked" label={t("blocked")} value={counts.blocked} />
        <CountCell testId="review-count-held-over" label={t("reviewCountHeldOver")} value={counts.heldOver} />
        <CountCell testId="review-count-approvable" label={t("reviewCountApprovable")} value={counts.approvable} />
      </dl>

      <div
        data-testid="review-filters"
        role="group"
        aria-label={t("reviewFiltersLabel")}
        className="mt-3 flex flex-wrap gap-2"
      >
        {REVIEW_FILTERS.map((key) => {
          const active = key === filter;
          const badge = filterCounts(counts, key);
          return (
            <button
              key={key}
              type="button"
              data-testid={`review-filter-${key}`}
              aria-pressed={active}
              onClick={() => chooseFilter(key)}
              className={
                "shrink-0 rounded-xl px-3 py-2 text-[11px] font-bold transition-colors " +
                (active
                  ? "bg-[#4F5FE8] text-white"
                  : "bg-[#1A1F36]/5 text-[#1A1F36]/70")
              }
            >
              {t(FILTER_LABEL_KEYS[key])} · {badge}
            </button>
          );
        })}
      </div>

      <div
        data-testid="review-list"
        className="mt-3 max-h-[70vh] space-y-2 overflow-y-auto overscroll-contain pe-1"
      >
        {view.items.map((recipient) => (
          <RecipientCard
            key={recipient.prospectId}
            recipient={recipient}
            locale={locale}
            t={t}
            cityLabel={cityLabel}
            segmentLabel={segmentLabel}
            onCopy={onCopy}
          />
        ))}

        {view.items.length === 0 && (
          <p
            data-testid="review-filter-empty"
            className="rounded-xl bg-[#1A1F36]/5 px-3 py-6 text-center text-[11px] font-bold text-[#1A1F36]/60"
          >
            {recipients.length === 0
              ? t("reviewNoRecipients")
              : t("reviewNoRecipientsInFilter")}
          </p>
        )}
      </div>

      <nav
        data-testid="review-pagination"
        aria-label={t("reviewPaginationLabel")}
        className="mt-3 flex flex-wrap items-center gap-2"
      >
        <button
          type="button"
          data-testid="review-page-prev"
          onClick={() => setPage(view.page - 1)}
          disabled={!view.hasPrevious}
          aria-label={t("reviewPreviousPage")}
          className="rounded-xl bg-[#1A1F36]/5 px-3 py-2 text-[11px] font-bold text-[#1A1F36] disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span
          data-testid="review-page-info"
          className="text-[11px] font-bold text-[#1A1F36]"
        >
          {t("reviewPageOf", { page: view.page, pages: view.pageCount })}
        </span>
        <button
          type="button"
          data-testid="review-page-next"
          onClick={() => setPage(view.page + 1)}
          disabled={!view.hasNext}
          aria-label={t("reviewNextPage")}
          className="rounded-xl bg-[#1A1F36]/5 px-3 py-2 text-[11px] font-bold text-[#1A1F36] disabled:opacity-40"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>

        <span
          data-testid="review-page-range"
          className="text-[11px] font-medium text-[#1A1F36]/60"
        >
          {t("reviewShowingRange", {
            first: view.first,
            last: view.last,
            total: view.total,
          })}
        </span>

        <label className="ms-auto flex items-center gap-1 text-[11px] font-bold text-[#1A1F36]/60">
          {t("reviewPageSize")}
          <select
            data-testid="review-page-size"
            value={view.pageSize}
            onChange={(event) => choosePageSize(Number(event.target.value))}
            className="rounded-xl bg-white px-2 py-1 text-[11px] font-bold text-[#1A1F36] shadow-soft"
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </nav>
    </section>
  );
}

function CountCell({
  testId,
  label,
  value,
}: {
  testId: string;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl bg-[#B8D4F5]/30 px-3 py-2">
      <dt className="text-[10px] font-bold uppercase tracking-wide text-[#1A1F36]/50">
        {label}
      </dt>
      <dd data-testid={testId} className="mt-0.5 text-base font-extrabold text-[#1A1F36]">
        {value}
      </dd>
    </div>
  );
}

function filterCounts(
  counts: ReturnType<typeof recipientReviewCounts>,
  filter: ReviewFilter
): number {
  switch (filter) {
    case "eligible":
      return counts.eligible;
    case "manual_only":
      return counts.manualOnly;
    case "blocked":
      return counts.blocked;
    case "held_over":
      return counts.heldOver;
    case "all":
    default:
      return counts.total;
  }
}

export function RecipientCard({
  recipient,
  locale,
  t,
  cityLabel,
  segmentLabel,
  onCopy,
}: {
  recipient: ReviewRecipient;
  locale: string;
  t: Translate;
  cityLabel?: (code: string | null) => string;
  segmentLabel?: (segment: string | null) => string;
  onCopy?: (text: string) => void;
}) {
  const dispositionLabel = t(
    recipient.disposition === "ELIGIBLE"
      ? "eligible"
      : recipient.disposition === "MANUAL_ONLY"
        ? "manualOnly"
        : "blocked"
  );
  const verification = recipientVerificationState(recipient);
  const consent = recipientConsentState(recipient);
  const suppression = recipientSuppressionState(recipient);
  const quota = recipientQuotaState(recipient);
  const channel = recipientChannel(recipient);
  const reasonText = recipientReasonText(recipient, locale);
  const message = hasMessagePreview(recipient) ? recipient.previewBody : null;

  const place = [
    recipient.city ? (cityLabel ? cityLabel(recipient.city) : recipient.city) : null,
    recipient.segment
      ? segmentLabel
        ? segmentLabel(recipient.segment)
        : recipient.segment
      : null,
    recipient.neighborhood ?? null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      data-testid="recipient-card"
      data-disposition={recipient.disposition}
      data-prospect-id={recipient.prospectId}
      data-within-quota={recipient.withinQuota === true ? "true" : "false"}
      className="min-w-0 rounded-2xl border border-[#1A1F36]/10 bg-white p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-bold text-[#1A1F36]">
            {recipient.publicName}
          </p>
          {place && (
            <p className="mt-0.5 break-words text-[11px] font-medium text-[#1A1F36]/60">
              {place}
            </p>
          )}
        </div>
        <span
          data-testid="recipient-disposition"
          className={
            "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[10px] font-bold text-white " +
            (recipient.disposition === "ELIGIBLE"
              ? "bg-[#34C759]"
              : recipient.disposition === "MANUAL_ONLY"
                ? "bg-[#FCA311]"
                : "bg-[#FF4D5E]")
          }
        >
          {dispositionLabel}
        </span>
      </div>

      <dl className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-[#1A1F36]/80 sm:grid-cols-2">
        <StateRow
          testId="recipient-verification"
          label={t("reviewStateVerification")}
          value={`${recipient.verificationStatus} · ${t(
            verification === "verified"
              ? "verified"
              : verification === "rejected"
                ? "rejected"
                : verification === "discovered"
                  ? "discovered"
                  : "verificationUnknown"
          )}`}
        />
        <StateRow
          testId="recipient-consent"
          label={t("reviewStateConsent")}
          value={t(
            consent === "granted"
              ? "consentGranted"
              : consent === "revoked"
                ? "consentRevoked"
                : consent === "expired"
                  ? "consentExpired"
                  : consent === "not_started"
                    ? "consentNotStarted"
                    : consent === "no_telegram_id"
                      ? "consentNoTelegramId"
                      : "consentNone"
          )}
        />
        <StateRow
          testId="recipient-suppression"
          label={t("reviewStateSuppression")}
          value={t(
            suppression === "suppressed"
              ? "suppressionSuppressed"
              : suppression === "unavailable"
                ? "suppressionUnavailable"
                : "suppressionClear"
          )}
        />
        <StateRow
          testId="recipient-quota"
          label={t("reviewStateQuota")}
          value={t(
            quota === "within_quota"
              ? "quotaWithin"
              : quota === "held_over"
                ? "quotaHeldOver"
                : "quotaBlocked"
          )}
        />
        <StateRow
          testId="recipient-channel"
          label={t("reviewStateChannel")}
          value={t(channel === "TELEGRAM_BOT" ? "channelBot" : "channelManual")}
        />
        <StateRow
          testId="recipient-destination"
          label={t("reviewStateDestination")}
          value={recipient.destination ?? "—"}
          ltr
        />
      </dl>

      <p className="mt-2 break-words text-[11px] font-bold text-[#B45309]">
        <span data-testid="recipient-reason" className="me-1 rounded bg-[#1A1F36]/5 px-1.5 py-0.5 font-mono text-[10px] text-[#1A1F36]/70" dir="ltr">
          {recipient.reason}
        </span>
        <span data-testid="recipient-reason-label">{reasonText}</span>
      </p>

      <p
        data-testid="recipient-checked-at"
        dir="ltr"
        className="mt-1 text-[10px] font-medium text-[#1A1F36]/45"
      >
        {t("reviewEvaluatedAt")}: {formatCheckedAt(recipient.checkedAt ?? null)}
      </p>

      {message ? (
        <div className="mt-2 min-w-0 rounded-xl bg-[#B8D4F5]/20 p-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#1A1F36]/50">
            {t("reviewExactMessage")}
          </p>
          <pre
            data-testid="recipient-message"
            dir="auto"
            className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-6 text-[#1A1F36]"
          >
            {message}
          </pre>
          {onCopy && (
            <button
              type="button"
              data-testid="recipient-copy"
              onClick={() => onCopy(message + (recipient.cta ? `\n\n${recipient.cta}` : ""))}
              className="mt-1 inline-flex items-center gap-1 rounded-xl bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#1A1F36] shadow-soft"
            >
              <ClipboardCopy className="h-3 w-3" />
              {t("copy")}
            </button>
          )}
        </div>
      ) : (
        <p
          data-testid="recipient-message-none"
          className="mt-2 flex items-start gap-1 rounded-xl bg-[#1A1F36]/5 px-2 py-1.5 text-[11px] font-bold text-[#1A1F36]/70"
        >
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          {t("reviewNoMessage")}
        </p>
      )}

      <p data-testid="recipient-cta" className="mt-2 text-[11px] font-bold text-[#1A1F36]">
        {t("reviewCta")}: {recipient.cta ?? t("reviewCtaNone")}
      </p>
    </article>
  );
}

function StateRow({
  testId,
  label,
  value,
  ltr = false,
}: {
  testId: string;
  label: string;
  value: string;
  ltr?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      <dt className="font-bold text-[#1A1F36]/50">{label}:</dt>
      <dd
        data-testid={testId}
        dir={ltr ? "ltr" : undefined}
        className="min-w-0 break-words"
      >
        {value}
      </dd>
    </div>
  );
}
