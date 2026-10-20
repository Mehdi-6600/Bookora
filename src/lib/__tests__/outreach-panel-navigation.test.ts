import { describe, expect, it } from "vitest";
import {
  ADVANCED_OUTREACH_TABS,
  isAdvancedOutreachTab,
  PRIMARY_OUTREACH_TABS,
} from "@/lib/outreach/panel-navigation";

describe("outreach panel navigation", () => {
  it("keeps the main workflow to three primary sections", () => {
    expect(PRIMARY_OUTREACH_TABS).toEqual(["overview", "campaigns", "prospects"]);
  });

  it("keeps maintenance tools out of the primary navigation without losing them", () => {
    expect(ADVANCED_OUTREACH_TABS).toEqual([
      "invitations",
      "templates",
      "keywords",
      "discovery",
      "bot",
    ]);
    expect(new Set([...PRIMARY_OUTREACH_TABS, ...ADVANCED_OUTREACH_TABS]).size).toBe(8);
    expect(isAdvancedOutreachTab("discovery")).toBe(true);
    expect(isAdvancedOutreachTab("campaigns")).toBe(false);
  });
});
