import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

import { OutreachPanel } from "@/components/outreach/outreach-panel";

describe("outreach panel main navigation", () => {
  it("shows only three primary tabs and collapses the maintenance tools", () => {
    const html = renderToStaticMarkup(<OutreachPanel />);

    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain("tab.overview");
    expect(html).toContain("tab.campaigns");
    expect(html).toContain("tab.prospects");
    expect(html).toContain("moreTools");
    expect(html).toContain("tab.discovery");
    expect(html).toContain("tab.invitations");
    expect(html).toContain("<details");
    expect(html).not.toContain("growthAgentTitle");
  });
});
