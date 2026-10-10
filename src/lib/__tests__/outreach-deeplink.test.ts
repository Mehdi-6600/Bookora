import { describe, expect, it } from "vitest";
import {
  buildBotDeepLink,
  buildCampaignStartParam,
  buildMiniAppDeepLink,
  buildProspectStartParam,
  isValidStartParam,
  parseStartPayload,
  START_PARAM_MAX_LENGTH,
} from "@/lib/outreach/deeplink";

describe("telegram deep links", () => {
  it("builds a prospect start parameter that Telegram accepts", () => {
    const param = buildProspectStartParam("cm1abcDEF123456789");

    expect(param.startsWith("p-")).toBe(true);
    expect(isValidStartParam(param)).toBe(true);
    expect(param.length).toBeLessThanOrEqual(START_PARAM_MAX_LENGTH);
  });

  it("strips characters Telegram does not allow", () => {
    const param = buildProspectStartParam("bad id/with spaces+plus");

    expect(isValidStartParam(param)).toBe(true);
    expect(param).toBe("p-badidwithspacesplus");
  });

  it("round-trips a prospect payload", () => {
    const id = "prospectId123";
    const parsed = parseStartPayload(buildProspectStartParam(id));

    expect(parsed).toEqual({ kind: "prospect", id });
  });

  it("round-trips a campaign payload", () => {
    const parsed = parseStartPayload(buildCampaignStartParam("tehran-barbers"));

    expect(parsed).toEqual({ kind: "campaign", code: "tehran-barbers" });
  });

  it("rejects start parameters that are not a valid Telegram payload", () => {
    for (const value of [
      "",
      "p-",
      "c-",
      "p-a b",
      "a".repeat(65),
      "p-x; DROP TABLE users;--",
      "../../etc/passwd",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(parseStartPayload(value)).toEqual({ kind: "none" });
    }
  });

  it("rejects strings outside the character set Telegram allows", () => {
    // Telegram only transports A-Z, a-z, 0-9, _ and - in a start parameter.
    for (const value of ["p-a b", "a".repeat(65), "p-x;", "", null, undefined, 42]) {
      expect(isValidStartParam(value)).toBe(false);
    }
  });

  it("builds bot and Mini App links with the configured username", () => {
    const botLink = buildBotDeepLink("p-abc123");
    const appLink = buildMiniAppDeepLink("p-abc123");

    expect(botLink).toMatch(/^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=p-abc123$/);
    expect(appLink).toMatch(/^https:\/\/t\.me\/[A-Za-z0-9_]+\?startapp=p-abc123$/);
  });
});
