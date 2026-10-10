import { describe, expect, it, vi } from "vitest";

// These suites cover pure logic only; keep them runnable without a database.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  categoryLabel,
  DEFAULT_TEMPLATES,
  renderTemplate,
  validateTemplateBody,
} from "@/lib/outreach/templates";
import { isClosedStatus } from "@/lib/outreach/eligibility";
import {
  isProspectStatus,
  normalizeLanguage,
  PROSPECT_STATUSES,
} from "@/lib/outreach/types";

describe("template rendering", () => {
  const vars = {
    businessName: "Mehdi Barber",
    link: "https://t.me/Bookora_App_bot?start=p-abc123",
    categoryLabel: "barbershop",
  };

  it("replaces every supported placeholder", () => {
    const body = "Hi {businessName}, your {category} link: {link}";
    const rendered = renderTemplate(body, vars);

    expect(rendered).toBe(
      "Hi Mehdi Barber, your barbershop link: https://t.me/Bookora_App_bot?start=p-abc123"
    );
  });

  it("keeps the link intact so the invitation can convert", () => {
    const rendered = renderTemplate("Open {link}", vars);
    expect(rendered).toContain("https://t.me/Bookora_App_bot?start=p-abc123");
  });

  it("drops unknown placeholders instead of leaking them", () => {
    const rendered = renderTemplate("Hi {businessName} {unknownToken}", vars);
    expect(rendered).not.toContain("{");
    expect(rendered).toContain("Mehdi Barber");
  });

  it("collapses runaway blank lines and trims", () => {
    const rendered = renderTemplate("\n\nHi {businessName}\n\n\n\n\n{link}\n\n", vars);
    expect(rendered.startsWith("Hi")).toBe(true);
    expect(rendered.endsWith(vars.link)).toBe(true);
    expect(rendered).not.toContain("\n\n\n");
  });
});

describe("template validation", () => {
  it("requires a link placeholder", () => {
    expect(validateTemplateBody("Hello there")).toBe("template.missingLink");
    expect(validateTemplateBody("Open {link}")).toBeNull();
  });

  it("rejects empty and oversized bodies", () => {
    expect(validateTemplateBody("   ")).toBe("template.empty");
    expect(validateTemplateBody("x".repeat(1501) + " {link}")).toBe("template.tooLong");
  });
});

describe("default templates", () => {
  it("ships English and Persian invitations and follow-ups", () => {
    const codes = DEFAULT_TEMPLATES.map((template) => template.code);

    expect(codes).toContain("invite_en_default");
    expect(codes).toContain("invite_fa_default");
    expect(codes).toContain("followup_en_default");
    expect(codes).toContain("followup_fa_default");
  });

  it("always includes the link placeholder", () => {
    for (const template of DEFAULT_TEMPLATES) {
      expect(template.body).toContain("{link}");
    }
  });

  it("always offers an opt-out", () => {
    for (const template of DEFAULT_TEMPLATES) {
      expect(template.body.toLowerCase()).toContain("stop");
    }
  });
});

describe("category labels", () => {
  it("localizes each category", () => {
    expect(categoryLabel("BARBER", "en")).toBe("barbershop");
    expect(categoryLabel("BARBER", "fa")).toBe("آرایشگاه مردانه");
    expect(categoryLabel("BEAUTY", "fa")).toBe("سالن زیبایی");
  });
});

describe("do-not-contact enforcement", () => {
  it("treats NOT_INTERESTED and DO_NOT_CONTACT as closed", () => {
    expect(isClosedStatus("NOT_INTERESTED")).toBe(true);
    expect(isClosedStatus("DO_NOT_CONTACT")).toBe(true);
  });

  it("keeps the rest of the funnel open", () => {
    for (const status of ["NEW", "CONTACTED", "INTERESTED", "STARTED_BOT", "REGISTERED", "ACTIVATED"]) {
      expect(isClosedStatus(status)).toBe(false);
    }
  });

  it("covers exactly the documented lifecycle statuses", () => {
    expect(PROSPECT_STATUSES).toEqual([
      "NEW",
      "CONTACTED",
      "INTERESTED",
      "STARTED_BOT",
      "REGISTERED",
      "ACTIVATED",
      "NOT_INTERESTED",
      "DO_NOT_CONTACT",
    ]);
  });

  it("rejects unknown statuses", () => {
    expect(isProspectStatus("MAYBE")).toBe(false);
    expect(isProspectStatus("NEW")).toBe(true);
  });
});

describe("language normalization", () => {
  it("maps telegram language codes onto supported languages", () => {
    expect(normalizeLanguage("fa")).toBe("fa");
    expect(normalizeLanguage("fa-IR")).toBe("fa");
    expect(normalizeLanguage("pes")).toBe("fa");
    expect(normalizeLanguage("ar")).toBe("ar");
    expect(normalizeLanguage("ar-EG")).toBe("ar");
    expect(normalizeLanguage("en")).toBe("en");
    expect(normalizeLanguage("de")).toBe("en");
  });

  it("defaults to English for missing values", () => {
    expect(normalizeLanguage(undefined)).toBe("en");
    expect(normalizeLanguage("")).toBe("en");
    expect(normalizeLanguage(null)).toBe("en");
  });
});
