import {
  DEFAULT_OUTREACH_SETTINGS,
  type OutreachSettings,
} from "@/lib/outreach/settings";

/**
 * Test fixture for "an administrator deliberately switched outreach on".
 *
 * Production is fail-closed: a missing or unreadable kill switch means
 * outreach stays off. A test that exercises approval or delivery therefore has
 * to state explicitly that outreach is enabled — otherwise it would be asserting
 * the behaviour of an unconfigured system.
 */
export const ENABLED_OUTREACH_SETTINGS: OutreachSettings = {
  ...DEFAULT_OUTREACH_SETTINGS,
  enabled: true,
  autoSendEnabled: true,
  sources: { enabled: "configured", autoSendEnabled: "configured" },
  warnings: [],
};

/** `admin_settings` rows that represent the same explicit opt-in. */
export function outreachSettingsRows(
  overrides: Record<string, string> = {}
): Array<{ key: string; value: string }> {
  return [
    { key: "outreach.enabled", value: "true" },
    { key: "outreach.auto_send_enabled", value: "true" },
    ...Object.entries(overrides).map(([key, value]) => ({ key, value })),
  ];
}
