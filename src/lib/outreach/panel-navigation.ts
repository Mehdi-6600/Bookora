export const PRIMARY_OUTREACH_TABS = ["overview", "campaigns", "prospects"] as const;
export const ADVANCED_OUTREACH_TABS = ["invitations", "templates", "keywords", "discovery", "bot"] as const;

export type OutreachPanelTab =
  | (typeof PRIMARY_OUTREACH_TABS)[number]
  | (typeof ADVANCED_OUTREACH_TABS)[number];

export function isAdvancedOutreachTab(tab: OutreachPanelTab): boolean {
  return (ADVANCED_OUTREACH_TABS as readonly string[]).includes(tab);
}
