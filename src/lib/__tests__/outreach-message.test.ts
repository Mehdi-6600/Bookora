import { describe, expect, it } from "vitest";
import {
  composeCampaignMessage,
  describeComposeError,
  findUnknownPlaceholders,
  messageDirection,
  previewCampaignMessage,
  validateDestinationUrl,
} from "@/lib/outreach/message";
import { renderTemplate, validateTemplateBody } from "@/lib/outreach/templates";

/**
 * The campaign message builder rules:
 *  - only http(s) URLs, dangerous schemes rejected outright;
 *  - no link is ever inserted unless the administrator selected it;
 *  - the missing Bookora channel URL is a validation error, never a guess;
 *  - the PREVIEW is the PREPARED message: both run compose + renderTemplate
 *    with the same variables, so they cannot drift apart.
 */

const CHANNEL = "https://t.me/spell0000";
const OTHER = "https://bookora.example/landing";

describe("destination URL validation", () => {
  it("accepts clean http(s) URLs and normalises them", () => {
    expect(validateDestinationUrl("https://t.me/spell0000")).toEqual({
      ok: true,
      url: "https://t.me/spell0000",
    });
    expect(validateDestinationUrl("  http://wa.me/98912  ").ok).toBe(true);
  });

  it("rejects javascript:, data:, vbscript: and friends", () => {
    for (const evil of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(document.cookie)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "blob:https://evil.example/1",
    ]) {
      const result = validateDestinationUrl(evil);
      expect(result.ok, evil).toBe(false);
      if (!result.ok) expect(result.reason, evil).toBe("scheme");
    }
  });

  it("rejects non-URLs, empties and control-character smuggling", () => {
    expect(validateDestinationUrl("not a url").ok).toBe(false);
    expect(validateDestinationUrl("").ok).toBe(false);
    expect(validateDestinationUrl(null).ok).toBe(false);
    expect(validateDestinationUrl(undefined).ok).toBe(false);
    // "https://a.com" + NUL + "evil": the control char is STRIPPED, not used to
    // smuggle an extra host — the result is one clean URL or a rejection.
    const stripped = validateDestinationUrl("https://a.com\u0000evil");
    expect(stripped.ok).toBe(true);
    if (stripped.ok) expect(stripped.url).toBe("https://a.comevil/");
  });

  it("enforces the length cap", () => {
    const tooLong = validateDestinationUrl("https://a.com/" + "x".repeat(600));
    if (!tooLong.ok) expect(tooLong.reason).toBe("tooLong");
    else throw new Error("expected tooLong rejection");
  });
});

describe("placeholder policy", () => {
  it("finds unknown tokens and leaves the three allowed ones", () => {
    expect(
      findUnknownPlaceholders("Hi {businessName} {link} {category} {ownerId}")
    ).toEqual(["{ownerId}"]);
    // A message with only allowed tokens (and none unknown) passes.
    expect(findUnknownPlaceholders("Hi {businessName}, {link}, {category}")).toEqual([]);
  });
});

describe("composer", () => {
  const base = {
    message: "سلام {businessName} عزیز 👋",
    cta: "از این لینک وارد بشید 👇",
    destinations: { bot: true, channel: false, other: false },
  };

  it("requires at least one selected destination", () => {
    const composed = composeCampaignMessage({
      ...base,
      destinations: { bot: false, channel: false, other: false },
    });
    expect(composed.errors).toContain("destinations.none");
  });

  it("rejects an empty message", () => {
    expect(composeCampaignMessage({ ...base, message: "   " }).errors).toContain(
      "message.empty"
    );
  });

  it("rejects unknown placeholders instead of rendering them away", () => {
    const composed = composeCampaignMessage({
      ...base,
      message: "Hi {businessName} {phone}",
    });
    expect(composed.errors).toContain("placeholder.unknown:{phone}");
  });

  it("rejects {link} when the bot destination is off (preview must match prepare)", () => {
    const composed = composeCampaignMessage({
      ...base,
      message: "Open {link}",
      destinations: { bot: false, channel: true },
      channelUrl: CHANNEL,
    });
    expect(composed.errors).toContain("placeholder.linkWithoutBot");
  });

  it("treats a missing channel URL as an error, never a guess", () => {
    const composed = composeCampaignMessage({
      ...base,
      destinations: { bot: false, channel: true },
      channelUrl: "",
    });
    expect(composed.errors).toContain("channelUrl.notConfigured");
  });

  it("bot-only appends {link} once and keeps the CTA", () => {
    const composed = composeCampaignMessage(base);
    expect(composed.errors).toEqual([]);
    expect(composed.body).toContain("سلام {businessName} عزیز 👋");
    expect(composed.body).toContain("از این لینک وارد بشید 👇");
    expect(composed.body.match(/\{link\}/g)).toHaveLength(1);
  });

  it("bot + channel includes both links", () => {
    const composed = composeCampaignMessage({
      ...base,
      destinations: { bot: true, channel: true },
      channelUrl: CHANNEL,
    });
    expect(composed.errors).toEqual([]);
    expect(composed.body).toContain("{link}");
    expect(composed.body).toContain(CHANNEL);
    expect(composed.links.map((l) => l.kind)).toEqual(["bot", "channel"]);
  });

  it("channel-only needs no {link} but still satisfies template validation", () => {
    const composed = composeCampaignMessage({
      ...base,
      destinations: { bot: false, channel: true },
      channelUrl: CHANNEL,
    });
    expect(composed.errors).toEqual([]);
    expect(composed.body).not.toContain("{link}");
    expect(validateTemplateBody(composed.body)).toBeNull();
  });

  it("never duplicates a link the admin already wrote inline", () => {
    const composed = composeCampaignMessage({
      message: `Visit ${OTHER} now`,
      cta: null,
      destinations: { bot: false, channel: false, other: true },
      otherUrl: OTHER,
    });
    expect(composed.errors).toEqual([]);
    expect(composed.appended).toHaveLength(0);
    expect(composed.body).toBe(`Visit ${OTHER} now`);
    expect(composed.links).toEqual([{ kind: "other", value: OTHER }]);
  });

  it("is idempotent: composing over its own output changes nothing", () => {
    const first = composeCampaignMessage(base);
    const second = composeCampaignMessage({ ...base, message: first.body });
    expect(second.body).toBe(first.body);
  });

  it("rejects dangerous destination URLs on the 'other' slot", () => {
    const composed = composeCampaignMessage({
      ...base,
      destinations: { bot: false, channel: false, other: true },
      otherUrl: "javascript:alert(1)",
    });
    expect(composed.errors).toContain("destinationUrl.scheme");
  });

  it("caps the final message length", () => {
    const composed = composeCampaignMessage({
      ...base,
      message: "x".repeat(1500),
    });
    expect(composed.errors).toContain("message.tooLong");
  });
});

describe("preview equals prepared message", () => {
  it("the saved body rendered by the prepare pipeline equals the preview", () => {
    const input = {
      message: "سلام {businessName} 👋\n\n{category} شما با بوکورا آنلاین رزرو می‌گیرد.",
      cta: "لینک شما 👇",
      destinations: { bot: true, channel: true },
      channelUrl: CHANNEL,
      otherUrl: null,
    };

    const { body: previewBody } = previewCampaignMessage(input, {
      businessName: "آرایشگاه نمونه",
      sampleLink: "https://t.me/BookoraBot?start=preview-abc",
      categoryLabel: "آرایشگاه مردانه",
    });

    // Server path: compose → store as template → preparation renders it with
    // the recipient's own deep link. Feed the SAME stored body through the
    // SAME renderer with a recipient-style link.
    const composed = composeCampaignMessage(input);
    const prepared = renderTemplate(composed.body, {
      businessName: "آرایشگاه نمونه",
      link: "https://t.me/BookoraBot?start=p-123456",
      categoryLabel: "آرایشگاه مردانه",
    });

    expect(previewBody).toContain("آرایشگاه نمونه");
    expect(previewBody).toContain(CHANNEL);
    expect(prepared.replace("start=p-123456", "START")).toBe(
      previewBody.replace("start=preview-abc", "START")
    );
  });
});

describe("language direction", () => {
  it("Persian and Arabic are RTL, everything else LTR", () => {
    expect(messageDirection("fa")).toBe("rtl");
    expect(messageDirection("ar")).toBe("rtl");
    expect(messageDirection("fa-IR")).toBe("rtl");
    expect(messageDirection("en")).toBe("ltr");
    expect(messageDirection("de")).toBe("ltr");
    expect(messageDirection(undefined)).toBe("ltr");
  });
});

describe("error copy", () => {
  it("has human copy for the safety-critical codes", () => {
    expect(describeComposeError("destinations.none")).toMatch(/destination/i);
    expect(describeComposeError("channelUrl.notConfigured")).toMatch(/configured/i);
    expect(describeComposeError("destinationUrl.scheme")).toMatch(/http/i);
    expect(describeComposeError("placeholder.unknown:{oops}")).toContain("{oops}");
  });
});
