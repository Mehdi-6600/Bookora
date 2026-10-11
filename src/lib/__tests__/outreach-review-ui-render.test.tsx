import { readFileSync } from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

/**
 * Critical fix E + H, rendered.
 *
 * These suites mount the real components with react-dom/server and the real
 * message catalogues, so they fail if a string is missing, if a blocked
 * recipient loses its reason, if a paginated list stops paging, or if a
 * sensitive control stops being disabled while the checks are unresolved.
 */

import { RecipientReview } from "@/components/outreach/recipient-review";
import {
  DisabledReasonHint,
  EmptyStateNotice,
  LoadFailureNotice,
  SettingsPausedNotice,
} from "@/components/outreach/operator-notices";
import { ManualSendPrompt } from "@/components/outreach/manual-send-prompt";
import type { ReviewRecipient } from "@/lib/outreach/recipient-review";

/* ------------------------------------------------------------------------- */
/* fixtures                                                                   */
/* ------------------------------------------------------------------------- */

function recipient(overrides: Partial<ReviewRecipient> = {}): ReviewRecipient {
  return {
    prospectId: "p-1",
    publicName: "Sample Barber",
    city: "TEHRAN",
    segment: "MENS_BARBER",
    neighborhood: "Vanak",
    language: "fa",
    disposition: "ELIGIBLE",
    verificationStatus: "VERIFIED",
    botConsent: true,
    suppressed: false,
    reason: "ok",
    reasonLabel: "Eligible: verified, consented and not suppressed.",
    reasonLabels: {
      en: "Eligible: verified, consented and not suppressed.",
      fa: "واجد شرایط: تأیید شده، دارای رضایت و خارج از فهرست عدم تماس.",
      ar: "مؤهل: تم التحقق، لديه موافقة وليس في قائمة الحظر.",
    },
    checkedAt: new Date("2026-10-11T04:05:00.000Z"),
    channel: "TELEGRAM_BOT",
    destination: "Telegram (bot, recipient already started it)",
    previewBody: "سلام {business}",
    cta: "صفحه رزرو خود را بسازید",
    withinQuota: true,
    heldOver: false,
    ...overrides,
  };
}

const PLAN = {
  settingsPaused: false,
  warnings: ["2 recipient(s) exceed the send limit (10) and will be held for a later run."],
  generatedAt: new Date("2026-10-11T04:05:00.000Z"),
  recipients: [
    recipient({ prospectId: "eligible-1", publicName: "Aria Salon" }),
    recipient({
      prospectId: "manual-1",
      publicName: "Manual Only Salon",
      disposition: "MANUAL_ONLY",
      botConsent: false,
      reason: "not_started_bot",
      reasonLabel: "Manual only: this person has not started the bot, so the bot may not message them.",
      reasonLabels: {
        en: "Manual only: this person has not started the bot, so the bot may not message them.",
        fa: "فقط دستی: این فرد بات را استارت نزده است؛ ارسال پیام خودکار مجاز نیست.",
        ar: "يدوي فقط: لم يبدأ هذا الشخص تشغيل البوت، لذا لا يمكن للبوت مراسلته.",
      },
      channel: "MANUAL",
      previewBody: null,
      withinQuota: true,
      heldOver: false,
    }),
    recipient({
      prospectId: "blocked-suppressed",
      publicName: "Suppressed Barbershop",
      disposition: "BLOCKED",
      botConsent: false,
      suppressed: true,
      reason: "suppressed",
      reasonLabel: "Blocked: this contact is on the do-not-contact list.",
      reasonLabels: {
        en: "Blocked: this contact is on the do-not-contact list.",
        fa: "مسدود: این مخاطب در فهرست عدم تماس است.",
        ar: "محظور: جهة الاتصال في قائمة عدم الاتصال.",
      },
      withinQuota: false,
      heldOver: false,
      previewBody: null,
    }),
    recipient({
      prospectId: "blocked-revoked",
      publicName: "Revoked Consent Salon",
      disposition: "BLOCKED",
      botConsent: false,
      reason: "consent_revoked",
      reasonLabel: "Blocked: the recipient withdrew bot permission.",
      reasonLabels: {
        en: "Blocked: the recipient withdrew bot permission.",
        fa: "مسدود: گیرنده اجازه ارسال پیام را پس گرفته است.",
        ar: "محظور: سحب المستلم إذن المراسلة.",
      },
      withinQuota: false,
      previewBody: null,
    }),
    recipient({
      prospectId: "blocked-suppression-unavailable",
      publicName: "Unreadable Suppression Salon",
      disposition: "BLOCKED",
      botConsent: false,
      reason: "suppression_unavailable",
      reasonLabel: "Blocked: the do-not-contact list could not be read, so nothing is sent.",
      reasonLabels: {
        en: "Blocked: the do-not-contact list could not be read, so nothing is sent.",
        fa: "مسدود: فهرست عدم تماس قابل خواندن نیست؛ ارسالی انجام نمی‌شود.",
        ar: "محظور: تعذّر قراءة قائمة عدم الاتصال، لذلك لن يتم الإرسال.",
      },
      withinQuota: false,
      previewBody: null,
    }),
    recipient({
      prospectId: "blocked-unverified",
      publicName: "Unverified Salon",
      disposition: "BLOCKED",
      verificationStatus: "DISCOVERED",
      botConsent: false,
      reason: "not_verified",
      reasonLabel: "Blocked: the prospect is not verified by an administrator.",
      reasonLabels: {
        en: "Blocked: the prospect is not verified by an administrator.",
        fa: "مسدود: این کسب‌وکار توسط مدیر تأیید نشده است.",
        ar: "محظور: لم يتم التحقق من هذا النشاط من قبل المسؤول.",
      },
      withinQuota: false,
      previewBody: null,
    }),
    recipient({
      prospectId: "manual-expired",
      publicName: "Expired Consent Salon",
      disposition: "MANUAL_ONLY",
      botConsent: false,
      reason: "consent_expired",
      reasonLabel: "Manual only: the stored bot consent is older than 90 days.",
      reasonLabels: {
        en: "Manual only: the stored bot consent is older than 90 days.",
        fa: "فقط دستی: رضایت ثبت‌شده قدیمی‌تر از ۹۰ روز است.",
        ar: "يدوي فقط: الموافقة المسجلة أقدم من 90 يوماً.",
      },
      withinQuota: true,
      previewBody: null,
    }),
    ...Array.from({ length: 5 }, (_, index) =>
      recipient({
        prospectId: `held-${index + 1}`,
        publicName: `Held Salon ${index + 1}`,
        withinQuota: false,
        heldOver: true,
      })
    ),
  ],
};

/* ------------------------------------------------------------------------- */
/* translation double: the real catalogues, missing keys fail loudly           */
/* ------------------------------------------------------------------------- */

function catalogue(locale: string): Record<string, string> {
  const file = path.join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf8")).outreach;
}

function makeT(locale: string) {
  const dictionary = catalogue(locale);
  return (key: string, values?: Record<string, unknown>) => {
    const raw = dictionary[key];
    if (raw === undefined) throw new Error(`missing ${locale} outreach key: ${key}`);
    return String(raw).replace(/\{(\w+)\}/g, (_, name: string) =>
      String(values?.[name] ?? `{${name}}`)
    );
  };
}

function attribute(html: string, testId: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`));
  return match?.[0] ?? "";
}

function elementHtml(html: string, testId: string, tag = "dd"): string {
  const match = html.match(
    new RegExp(`<${tag}[^>]*data-testid="${testId}"[^>]*>[\\s\\S]*?</${tag}>`)
  );
  return match?.[0] ?? "";
}

function countOccurrences(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

/* ------------------------------------------------------------------------- */
/* tests                                                                      */
/* ------------------------------------------------------------------------- */

describe("the full recipient list is paginated and complete", () => {
  const html = renderToStaticMarkup(
    <RecipientReview plan={PLAN} locale="en" t={makeT("en")} />
  );

  it("lists every matched recipient across pages", () => {
    expect(countOccurrences(html, 'data-testid="recipient-card"')).toBe(10);
    expect(html).toContain("Page 1 of 2");
    expect(html).toContain("Showing 1–10 of 12");
  });

  it("disables previous on the first page and enables next", () => {
    expect(attribute(html, "review-page-prev")).toContain("disabled");
    expect(attribute(html, "review-page-next")).not.toContain('disabled=""');
  });

  it("offers a filter for every state, with its count", () => {
    const filters = attribute(html, "review-filters");
    expect(filters).toContain('role="group"');
    for (const key of ["all", "eligible", "manual_only", "blocked", "held_over"]) {
      expect(html).toContain(`data-testid="review-filter-${key}"`);
    }
    expect(elementHtml(html, "review-count-total")).toContain("12");
    expect(elementHtml(html, "review-count-blocked")).toContain("4");
    expect(elementHtml(html, "review-count-manual-only")).toContain("2");
    expect(elementHtml(html, "review-count-eligible")).toContain("6");
    expect(elementHtml(html, "review-count-held-over")).toContain("5");
    expect(elementHtml(html, "review-count-approvable")).toContain("1");
  });

  it("shows the quota warnings the server sent", () => {
    expect(elementHtml(html, "review-warning", "p")).toContain("held for a later run");
  });

  it("scrolls on a phone instead of overflowing", () => {
    expect(attribute(html, "review-list")).toContain("max-h-[70vh]");
    expect(attribute(html, "review-list")).toContain("overflow-y-auto");
  });
});

describe("every eligibility and consent state is visible", () => {
  const html = renderToStaticMarkup(
    <RecipientReview plan={PLAN} locale="en" t={makeT("en")} />
  );

  it("labels blocked recipients as blocked, never as manual", () => {
    const blockedCard = html.match(
      /<article[^>]*data-prospect-id="blocked-suppressed"[\s\S]*?<\/article>/
    )?.[0];
    expect(blockedCard).toBeTruthy();
    expect(blockedCard).toContain('data-disposition="BLOCKED"');
    expect(blockedCard).toContain("Blocked:");
    expect(blockedCard).toContain("suppressed");
    expect(blockedCard).toContain("On the do-not-contact list — blocked");
  });

  it("shows withdrawn consent and the fail-closed suppression state", () => {
    const revoked = html.match(
      /<article[^>]*data-prospect-id="blocked-revoked"[\s\S]*?<\/article>/
    )?.[0];
    expect(revoked).toContain("Withdrawn by the recipient");
    expect(revoked).toContain("Not sendable");

    const unavailable = html.match(
      /<article[^>]*data-prospect-id="blocked-suppression-unavailable"[\s\S]*?<\/article>/
    )?.[0];
    expect(unavailable).toContain("Could not be read — treated as blocked");
  });

  it("shows manual-only, expired consent, verification and quota state", () => {
    const manual = html.match(
      /<article[^>]*data-prospect-id="manual-1"[\s\S]*?<\/article>/
    )?.[0];
    expect(manual).toContain('data-disposition="MANUAL_ONLY"');
    expect(manual).toContain("Not started the bot — manual channel only");
    expect(manual).toContain("Manual, outside the application");

    const expired = html.match(
      /<article[^>]*data-prospect-id="manual-expired"[\s\S]*?<\/article>/
    )?.[0];
    expect(expired).toContain("Expired — older than 90 days");

    const unverified = html.match(
      /<article[^>]*data-prospect-id="blocked-unverified"[\s\S]*?<\/article>/
    )?.[0];
    expect(elementHtml(unverified ?? "", "recipient-verification")).toContain("DISCOVERED");
  });

  it("shows the exact outgoing message, the CTA, or explains why there is none", () => {
    const eligible = html.match(
      /<article[^>]*data-prospect-id="eligible-1"[\s\S]*?<\/article>/
    )?.[0];
    expect(eligible).toContain('data-testid="recipient-message"');
    expect(eligible).toContain("سلام");
    expect(elementHtml(eligible ?? "", "recipient-cta", "p")).toContain("صفحه رزرو");

    const blocked = html.match(
      /<article[^>]*data-prospect-id="blocked-suppressed"[\s\S]*?<\/article>/
    )?.[0];
    expect(blocked).toContain('data-testid="recipient-message-none"');
    expect(blocked).toContain("No message is prepared for this recipient");
  });

  it("timestamps each evaluation", () => {
    const eligible = html.match(
      /<article[^>]*data-prospect-id="eligible-1"[\s\S]*?<\/article>/
    )?.[0];
    expect(elementHtml(eligible ?? "", "recipient-checked-at", "p")).toContain(
      "2026-10-11 04:05 UTC"
    );
  });
});

describe("Persian and Arabic render right-to-left", () => {
  it("sets the direction and translates the states", () => {
    const html = renderToStaticMarkup(
      <RecipientReview plan={PLAN} locale="fa" t={makeT("fa")} dir="rtl" />
    );
    expect(attribute(html, "recipient-review")).toContain('dir="rtl"');
    expect(html).toContain("بازبینی گیرندگان");
    expect(html).toContain("صفحه 1 از 2");
    expect(html).toContain("مسدود");
    // Latin-only values stay left-to-right inside the RTL layout.
    expect(elementHtml(html, "recipient-destination")).toContain('dir="ltr"');
  });

  it("renders the Arabic catalogue too", () => {
    const html = renderToStaticMarkup(
      <RecipientReview plan={PLAN} locale="ar" t={makeT("ar")} dir="rtl" />
    );
    expect(attribute(html, "recipient-review")).toContain('dir="rtl"');
    expect(html).toContain("مراجعة المستلمين");
  });
});

describe("empty and paused states", () => {
  it("says 'no recipients' instead of rendering an empty box", () => {
    const html = renderToStaticMarkup(
      <RecipientReview
        plan={{ recipients: [], warnings: [], generatedAt: null }}
        locale="en"
        t={makeT("en")}
      />
    );
    expect(elementHtml(html, "review-filter-empty", "p")).toContain("No recipient matched this campaign");
    expect(countOccurrences(html, 'data-testid="recipient-card"')).toBe(0);
    expect(html).toContain("Page 1 of 1");
  });

  it("warns loudly when the kill switch makes the whole plan unusable", () => {
    const html = renderToStaticMarkup(
      <RecipientReview
        plan={{ ...PLAN, settingsPaused: true }}
        locale="en"
        t={makeT("en")}
      />
    );
    expect(elementHtml(html, "review-settings-paused", "p")).toContain("Outreach is paused");
  });
});

describe("load failures are visible and never look empty", () => {
  it("renders an alert with the server message and a retry action", () => {
    const html = renderToStaticMarkup(
      <LoadFailureNotice
        testId="campaigns-load-error"
        title="The campaign list could not be loaded."
        message="503: settings unreadable"
        onRetry={() => undefined}
        t={makeT("en")}
      />
    );
    expect(attribute(html, "campaigns-load-error")).toContain('role="alert"');
    expect(html).toContain("The campaign list could not be loaded.");
    expect(html).toContain("503: settings unreadable");
    expect(html).toContain("Nothing is approved or sent while this is failing");
    expect(html).toContain('data-testid="campaigns-load-error-retry"');
    expect(html).not.toContain('data-testid="outreach-empty"');
  });

  it("keeps the empty state free of error styling", () => {
    const html = renderToStaticMarkup(
      <EmptyStateNotice testId="campaigns-empty" message="No campaigns yet." />
    );
    expect(html).toContain('data-testid="campaigns-empty"');
    expect(html).toContain("No campaigns yet.");
    expect(html).not.toContain('role="alert"');
  });

  it("explains a paused kill switch in the operator's language", () => {
    const html = renderToStaticMarkup(<SettingsPausedNotice t={makeT("fa")} />);
    expect(html).toContain("ارسال خاموش است");
  });
});

describe("disabled controls explain themselves", () => {
  it("renders the reason as visible text", () => {
    const html = renderToStaticMarkup(
      <DisabledReasonHint reason="controlBlockedSettingsPaused" t={makeT("en")} />
    );
    expect(html).toContain("Outreach is paused, or its settings could not be read.");
  });

  it("renders nothing when the control is enabled", () => {
    const html = renderToStaticMarkup(
      <DisabledReasonHint reason={null} t={makeT("en")} />
    );
    expect(html).toBe("");
  });

  it("translates the kill-switch reason for Persian operators", () => {
    const html = renderToStaticMarkup(
      <DisabledReasonHint
        reason="controlBlockedSettingsPaused"
        t={makeT("fa")}
        testId="control-disabled-reason"
      />
    );
    expect(html).toContain("ارسال متوقف است");
  });
});

describe("the manual-send evidence prompt follows the server contract", () => {
  const html = renderToStaticMarkup(
    <ManualSendPrompt
      recipientName="Aria Salon"
      t={makeT("en")}
      onSubmit={() => undefined}
      onCancel={() => undefined}
    />
  );

  it("asks for evidence and an explicit confirmation, and starts disabled", () => {
    expect(html).toContain('data-testid="manual-send-evidence"');
    expect(html).toContain('data-testid="manual-send-confirm"');
    expect(attribute(html, "manual-send-submit")).toContain("disabled");
    expect(attribute(html, "manual-send-cancel")).not.toContain('disabled=""');
    expect(html).toContain("Aria Salon");
  });

  it("states the rules instead of implying a message was sent", () => {
    expect(html).toContain("No Telegram message is sent");
    expect(html).toContain("recorded as SENT");
    expect(html).toContain("re-checks verification, do-not-contact, opt-out, consent and the kill switch");
    expect(html).toContain("3–500");
  });

  it("caps the evidence input at the length the server accepts", () => {
    expect(attribute(html, "manual-send-evidence")).toContain('maxLength="500"');
    expect(attribute(html, "manual-send-evidence")).toContain('dir="auto"');
  });

  it("shows the server's rejection verbatim when an attestation is refused", () => {
    const rejected = renderToStaticMarkup(
      <ManualSendPrompt
        recipientName="Aria Salon"
        t={makeT("en")}
        error="Blocked: this contact is on the do-not-contact list."
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    );
    expect(attribute(rejected, "manual-send-error")).toContain('role="alert"');
    expect(rejected).toContain("do-not-contact list");
  });
});
