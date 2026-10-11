import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Critical fix E, UI half — the pure review logic behind the recipient list.
 *
 * The panel used to render an unpaginated preview that mislabelled every
 * non-eligible recipient as "manual only" and printed raw reason codes. These
 * tests pin the replacement: every recipient is pageable, every state is
 * derived from the server's own fields, and no blocking reason is ever hidden.
 */

import {
  DEFAULT_REVIEW_PAGE_SIZE,
  REVIEW_FILTERS,
  REVIEW_PAGE_SIZES,
  clampReviewPage,
  exactOutgoingMessage,
  filterRecipients,
  formatCheckedAt,
  hasMessagePreview,
  matchesReviewFilter,
  normalizePageSize,
  paginateRecipients,
  recipientChannel,
  recipientConsentState,
  recipientQuotaState,
  recipientReasonText,
  recipientReviewCounts,
  recipientSuppressionState,
  recipientVerificationState,
  reviewPageCount,
  type ReviewRecipient,
} from "@/lib/outreach/recipient-review";

function recipient(overrides: Partial<ReviewRecipient> = {}): ReviewRecipient {
  return {
    prospectId: "p-1",
    publicName: "Sample Barber",
    city: "TEHRAN",
    segment: "MENS_BARBER",
    neighborhood: null,
    language: "en",
    disposition: "ELIGIBLE",
    verificationStatus: "VERIFIED",
    botConsent: true,
    suppressed: false,
    reason: "ok",
    reasonLabel: "Eligible: verified, consented and not suppressed.",
    checkedAt: new Date("2026-10-11T00:00:00.000Z"),
    channel: "TELEGRAM_BOT",
    destination: "Telegram (bot, recipient already started it)",
    previewBody: "Hi Sample Barber",
    cta: "Claim your page",
    withinQuota: true,
    heldOver: false,
    ...overrides,
  };
}

describe("filtering the full recipient list", () => {
  const list = [
    recipient({ prospectId: "a", disposition: "ELIGIBLE" }),
    recipient({ prospectId: "b", disposition: "MANUAL_ONLY", botConsent: false, reason: "not_started_bot" }),
    recipient({ prospectId: "c", disposition: "BLOCKED", botConsent: false, reason: "suppressed", suppressed: true, withinQuota: false }),
    recipient({ prospectId: "d", disposition: "ELIGIBLE", heldOver: true, withinQuota: false }),
  ];

  it("offers every disposition plus the quota view", () => {
    expect(REVIEW_FILTERS).toEqual([
      "all",
      "eligible",
      "manual_only",
      "blocked",
      "held_over",
    ]);
  });

  it("keeps blocked recipients in the list instead of dropping them", () => {
    expect(filterRecipients(list, "all")).toHaveLength(4);
    expect(filterRecipients(list, "blocked").map((r) => r.prospectId)).toEqual(["c"]);
    expect(filterRecipients(list, "eligible").map((r) => r.prospectId)).toEqual(["a", "d"]);
    expect(filterRecipients(list, "manual_only").map((r) => r.prospectId)).toEqual(["b"]);
    expect(filterRecipients(list, "held_over").map((r) => r.prospectId)).toEqual(["d"]);
  });

  it("counts every state, including the ones the quota holds back", () => {
    expect(recipientReviewCounts(list)).toEqual({
      total: 4,
      eligible: 2,
      manualOnly: 1,
      blocked: 1,
      heldOver: 1,
      approvable: 1,
    });
  });

  it("only matches a filter it knows", () => {
    expect(matchesReviewFilter(list[0], "all")).toBe(true);
    expect(matchesReviewFilter(list[2], "eligible")).toBe(false);
  });
});

describe("pagination", () => {
  const many = Array.from({ length: 23 }, (_, index) =>
    recipient({ prospectId: `p-${index + 1}` })
  );

  it("offers the sizes the reviewer needs and normalises anything else", () => {
    expect(REVIEW_PAGE_SIZES).toEqual([10, 25, 50, 100]);
    expect(normalizePageSize(25)).toBe(25);
    expect(normalizePageSize("50")).toBe(50);
    expect(normalizePageSize(7)).toBe(DEFAULT_REVIEW_PAGE_SIZE);
    expect(normalizePageSize("nonsense")).toBe(DEFAULT_REVIEW_PAGE_SIZE);
  });

  it("always reports at least one page, even for an empty list", () => {
    expect(reviewPageCount(0, 10)).toBe(1);
    expect(reviewPageCount(10, 10)).toBe(1);
    expect(reviewPageCount(11, 10)).toBe(2);
    expect(reviewPageCount(23, 25)).toBe(1);
  });

  it("renders every recipient across pages without losing any", () => {
    const first = paginateRecipients(many, 1, 10);
    expect(first.items).toHaveLength(10);
    expect(first.first).toBe(1);
    expect(first.last).toBe(10);
    expect(first.hasPrevious).toBe(false);
    expect(first.hasNext).toBe(true);

    const last = paginateRecipients(many, 3, 10);
    expect(last.items.map((r) => r.prospectId)).toEqual(["p-21", "p-22", "p-23"]);
    expect(last.page).toBe(3);
    expect(last.hasNext).toBe(false);

    const seen = new Set([
      ...first.items,
      ...paginateRecipients(many, 2, 10).items,
      ...last.items,
    ].map((r) => r.prospectId));
    expect(seen.size).toBe(23);
  });

  it("clamps out-of-range pages instead of showing an empty view", () => {
    expect(clampReviewPage(0, 23, 10)).toBe(1);
    expect(clampReviewPage(99, 23, 10)).toBe(3);
    expect(clampReviewPage(Number.NaN, 23, 10)).toBe(1);
    expect(paginateRecipients(many, 99, 10).page).toBe(3);
  });

  it("reports an empty range for an empty list", () => {
    const page = paginateRecipients([], 1, 10);
    expect(page.items).toEqual([]);
    expect(page.page).toBe(1);
    expect(page.pageCount).toBe(1);
    expect(page.first).toBe(0);
    expect(page.last).toBe(0);
  });
});

describe("per-recipient eligibility and consent states", () => {
  it("never invents consent", () => {
    expect(recipientConsentState(recipient({ botConsent: true }))).toBe("granted");
    expect(
      recipientConsentState(
        recipient({ botConsent: false, reason: "consent_revoked" })
      )
    ).toBe("revoked");
    expect(
      recipientConsentState(
        recipient({ botConsent: false, reason: "consent_expired" })
      )
    ).toBe("expired");
    expect(
      recipientConsentState(
        recipient({ botConsent: false, reason: "not_started_bot" })
      )
    ).toBe("not_started");
    expect(
      recipientConsentState(
        recipient({ botConsent: false, reason: "no_telegram_id" })
      )
    ).toBe("no_telegram_id");
    expect(
      recipientConsentState(
        recipient({ botConsent: false, reason: "opted_out" })
      )
    ).toBe("none");
  });

  it("maps verification statuses, and unknown stays unknown", () => {
    expect(recipientVerificationState(recipient({ verificationStatus: "VERIFIED" }))).toBe("verified");
    expect(recipientVerificationState(recipient({ verificationStatus: "DISCOVERED" }))).toBe("discovered");
    expect(recipientVerificationState(recipient({ verificationStatus: "REJECTED" }))).toBe("rejected");
    expect(recipientVerificationState(recipient({ verificationStatus: "" }))).toBe("unknown");
  });

  it("treats an unreadable do-not-contact list as blocked, not clear", () => {
    expect(
      recipientSuppressionState(recipient({ suppressed: true }))
    ).toBe("suppressed");
    expect(
      recipientSuppressionState(
        recipient({
          suppressed: false,
          reason: "suppression_unavailable",
          disposition: "BLOCKED",
        })
      )
    ).toBe("unavailable");
    expect(recipientSuppressionState(recipient({ suppressed: false }))).toBe("clear");
  });

  it("distinguishes inside-quota, held-over and blocked", () => {
    expect(recipientQuotaState(recipient({ withinQuota: true }))).toBe("within_quota");
    expect(
      recipientQuotaState(recipient({ withinQuota: false, heldOver: true }))
    ).toBe("held_over");
    expect(
      recipientQuotaState(
        recipient({ disposition: "BLOCKED", withinQuota: false, heldOver: false })
      )
    ).toBe("blocked");
  });

  it("shows the channel the recipient would actually be reached through", () => {
    expect(recipientChannel(recipient({ disposition: "ELIGIBLE" }))).toBe("TELEGRAM_BOT");
    expect(
      recipientChannel(
        recipient({
          disposition: "MANUAL_ONLY",
          botConsent: false,
          channel: undefined,
        })
      )
    ).toBe("MANUAL");
    expect(
      recipientChannel(recipient({ disposition: "ELIGIBLE", channel: "MANUAL" }))
    ).toBe("MANUAL");
  });
});

describe("blocking reasons stay visible in the reviewer's language", () => {
  it("prefers the localised labels the server sends", () => {
    const blocked = recipient({
      disposition: "BLOCKED",
      reason: "suppressed",
      reasonLabel: "Blocked: this contact is on the do-not-contact list.",
      reasonLabels: {
        en: "Blocked: this contact is on the do-not-contact list.",
        fa: "مسدود: این مخاطب در فهرست عدم تماس است.",
        ar: "محظور: جهة الاتصال في قائمة عدم الاتصال.",
      },
    });
    expect(recipientReasonText(blocked, "en")).toContain("do-not-contact");
    expect(recipientReasonText(blocked, "fa")).toContain("فهرست عدم تماس");
    expect(recipientReasonText(blocked, "ar")).toContain("قائمة عدم الاتصال");
  });

  it("falls back to the English label, then to the raw code", () => {
    const englishOnly = recipient({
      disposition: "BLOCKED",
      reason: "opted_out",
      reasonLabel: "Blocked: this prospect opted out.",
      reasonLabels: null,
    });
    expect(recipientReasonText(englishOnly, "fa")).toBe(
      "Blocked: this prospect opted out."
    );

    const bare = recipient({
      disposition: "BLOCKED",
      reason: "some_future_reason",
      reasonLabel: null,
      reasonLabels: undefined,
    });
    expect(recipientReasonText(bare, "fa")).toBe("some_future_reason");
  });
});

describe("the exact outgoing message", () => {
  it("appends the campaign CTA and keeps the body byte-for-byte", () => {
    const withCta = recipient({ previewBody: "Body line 1\nBody line 2", cta: "Book now" });
    expect(exactOutgoingMessage(withCta)).toBe("Body line 1\nBody line 2\n\nBook now");
    expect(hasMessagePreview(withCta)).toBe(true);
  });

  it("returns just the body when the campaign defines no CTA", () => {
    expect(exactOutgoingMessage(recipient({ previewBody: "Body", cta: null }))).toBe("Body");
    expect(exactOutgoingMessage(recipient({ previewBody: "Body", cta: "   " }))).toBe("Body");
  });

  it("reports no message when the server rendered none", () => {
    expect(exactOutgoingMessage(recipient({ previewBody: null }))).toBeNull();
    expect(exactOutgoingMessage(recipient({ previewBody: "" }))).toBeNull();
    expect(hasMessagePreview(recipient({ previewBody: null }))).toBe(false);
  });
});

describe("evaluation timestamps", () => {
  it("renders an ISO instant and a placeholder otherwise", () => {
    expect(formatCheckedAt(new Date("2026-10-11T05:06:07.000Z"))).toBe(
      "2026-10-11 05:06 UTC"
    );
    expect(formatCheckedAt("2026-10-11T05:06:07.000Z")).toBe("2026-10-11 05:06 UTC");
    expect(formatCheckedAt(null)).toBe("—");
    expect(formatCheckedAt("not-a-date")).toBe("—");
  });
});

describe("the message catalogue", () => {
  const locales = ["en", "fa", "ar"] as const;

  function outreach(locale: string): Record<string, string> {
    const file = path.join(process.cwd(), "messages", `${locale}.json`);
    return JSON.parse(readFileSync(file, "utf8")).outreach;
  }

  const keys = [
    "recipientReviewTitle",
    "recipientReviewHelp",
    "reviewEvaluatedAt",
    "reviewSettingsPaused",
    "reviewCountTotal",
    "reviewCountHeldOver",
    "reviewCountApprovable",
    "reviewFilterAll",
    "reviewFilterEligible",
    "reviewFilterManualOnly",
    "reviewFilterBlocked",
    "reviewFilterHeldOver",
    "reviewNoRecipients",
    "reviewNoRecipientsInFilter",
    "reviewPageOf",
    "reviewShowingRange",
    "reviewStateVerification",
    "reviewStateConsent",
    "reviewStateSuppression",
    "reviewStateQuota",
    "reviewStateChannel",
    "reviewStateDestination",
    "consentGranted",
    "consentRevoked",
    "consentExpired",
    "consentNotStarted",
    "consentNoTelegramId",
    "consentNone",
    "suppressionSuppressed",
    "suppressionClear",
    "suppressionUnavailable",
    "quotaWithin",
    "quotaHeldOver",
    "quotaBlocked",
    "channelBot",
    "channelManual",
    "reviewExactMessage",
    "reviewNoMessage",
    "reviewCta",
    "reviewCtaNone",
    "verificationUnknown",
    "loadFailedTitle",
    "loadFailedHelp",
    "retry",
    "settingsPausedNotice",
    "campaignsLoadFailed",
    "invitationsLoadFailed",
    "manualSendTitle",
    "manualSendFor",
    "manualSendNoMessage",
    "manualSendRecordedAsSent",
    "manualSendServerChecks",
    "manualSendEvidenceLabel",
    "manualSendEvidencePlaceholder",
    "manualSendEvidenceOk",
    "manualSendConfirm",
    "manualEvidenceMissing",
    "manualEvidenceTooShort",
    "manualEvidenceTooLong",
    "controlBlockedUnresolved",
    "controlBlockedBusy",
    "controlBlockedPlanMissing",
    "controlBlockedPlanStale",
    "controlBlockedSettingsPaused",
    "controlBlockedNoEligible",
    "controlBlockedAlreadyApproved",
    "controlBlockedTerminal",
    "controlBlockedNotApproved",
    "controlBlockedQuotaFull",
    "controlBlockedNotDraft",
    "controlBlockedNotReviewable",
    "controlBlockedNotApprovedInvitation",
    "planStaleNotice",
    "settingsUnreadableNotice",
    "manualSendRecorded",
    "prepareCountLabel",
    "saved",
  ];

  it("translates every new string in all three locales", () => {
    for (const locale of locales) {
      const dictionary = outreach(locale);
      const missing = keys.filter((key) => !dictionary[key]);
      expect(missing, `${locale} is missing ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("keeps the three catalogues structurally identical", () => {
    const [en, fa, ar] = locales.map((locale) => Object.keys(outreach(locale)).sort());
    expect(fa).toEqual(en);
    expect(ar).toEqual(en);
  });
});
