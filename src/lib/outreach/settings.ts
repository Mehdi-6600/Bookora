import { prisma } from "@/lib/prisma";
import { normalizeTimeZone } from "@/lib/booking/time";
import {
  MAX_CAMPAIGN_CITIES,
  normalizeCityCodeList,
} from "@/lib/outreach/city-registry";

/**
 * Outreach configuration.
 *
 * Values live in the existing `admin_settings` table so no new infrastructure
 * is required. Every read falls back to a documented default, and every write
 * is validated before it is persisted.
 */

export const OUTREACH_SETTING_KEYS = [
  "outreach.enabled",
  "outreach.auto_send_enabled",
  "outreach.daily_discovery_limit",
  "outreach.daily_invitation_limit",
  "outreach.timezone",
  "outreach.run_local_hour",
  "outreach.feed_url",
  "outreach.feed_enabled",
  "outreach.min_score",
  /// Public Bookora Telegram channel link. Empty until the owner supplies the
  /// real URL — the system must never invent or guess a channel link.
  "outreach.channel_url",
  /// Administrator-approved extra city codes (comma separated registry codes).
  "outreach.cities_enabled",
  /// Registry codes explicitly disabled for new campaign targeting.
  "outreach.cities_disabled",
] as const;

export type OutreachSettingKey = (typeof OUTREACH_SETTING_KEYS)[number];

export function isOutreachSettingKey(
  value: string
): value is OutreachSettingKey {
  return (OUTREACH_SETTING_KEYS as readonly string[]).includes(value);
}

export const DEFAULT_DAILY_DISCOVERY_LIMIT = 50;
export const DEFAULT_DAILY_INVITATION_LIMIT = 10;
export const DEFAULT_MIN_SCORE = 30;

/** Upper bounds protect the database and keep outreach deliberately low volume. */
export const MAX_DAILY_DISCOVERY_LIMIT = 500;
export const MAX_DAILY_INVITATION_LIMIT = 100;

/**
 * Where a value came from. Only `"configured"` may ever authorise outreach:
 * `"default"` (row missing or value invalid) and `"error"` (storage unreadable)
 * are fail-closed states, never permission.
 */
export type OutreachSettingSource = "configured" | "default" | "error";

export type OutreachSettings = {
  enabled: boolean;
  readError?: string;
  autoSendEnabled: boolean;
  dailyDiscoveryLimit: number;
  dailyInvitationLimit: number;
  timezone: string;
  runLocalHour: number;
  feedUrl: string;
  feedEnabled: boolean;
  minScore: number;
  /// Public channel link used by the campaign message builder. Empty string
  /// means "not configured yet"; the builder then refuses to enable the
  /// channel destination instead of fabricating a link.
  channelUrl: string;
  /**
   * Provenance of the two kill switches, so the UI and the API can tell a
   * genuine administrator decision apart from a fallback.
   */
  sources: {
    enabled: OutreachSettingSource;
    autoSendEnabled: OutreachSettingSource;
  };
  /// Admin-facing explanation of every value that was not genuinely configured.
  warnings: string[];
};

/**
 * Fallback values for non-safety settings only.
 *
 * The two kill switches are NOT defaulted to "on": a missing or unreadable
 * `outreach.enabled` / `outreach.auto_send_enabled` means disabled, so a broken
 * or incomplete settings store can never authorise an outbound message.
 */
export const DEFAULT_OUTREACH_SETTINGS: Omit<
  OutreachSettings,
  "sources" | "warnings"
> = {
  enabled: false,
  autoSendEnabled: false,
  dailyDiscoveryLimit: DEFAULT_DAILY_DISCOVERY_LIMIT,
  dailyInvitationLimit: DEFAULT_DAILY_INVITATION_LIMIT,
  timezone: "UTC",
  runLocalHour: 6,
  feedUrl: "",
  feedEnabled: false,
  minScore: DEFAULT_MIN_SCORE,
  channelUrl: "",
};

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "true" || value === "1";
}

/**
 * Read a kill switch fail-closed.
 *
 * Anything other than an explicitly stored "true"/"1" means NO: a missing row,
 * an empty value, a typo ("yes", "TRUE") or a corrupted row all resolve to
 * `false` and are reported as an unconfigured fallback, never as permission.
 */
function readKillSwitch(
  key: OutreachSettingKey,
  value: string | undefined
): { value: boolean; source: OutreachSettingSource; warning: string | null } {
  if (value === undefined) {
    return {
      value: false,
      source: "default",
      warning: `${key} is not configured. Outreach stays switched off until an administrator sets it explicitly.`,
    };
  }
  if (value === "true" || value === "1") {
    return { value: true, source: "configured", warning: null };
  }
  if (value === "false" || value === "0") {
    return { value: false, source: "configured", warning: null };
  }
  return {
    value: false,
    source: "default",
    warning: `${key} holds an unrecognised value. Treating outreach as switched off; store "true" or "false".`,
  };
}

function readInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function coerceSettingValue(
  key: OutreachSettingKey,
  raw: unknown
): string | null {
  switch (key) {
    case "outreach.enabled":
    case "outreach.auto_send_enabled":
    case "outreach.feed_enabled": {
      if (typeof raw === "boolean") return raw ? "true" : "false";
      if (raw === "true" || raw === "false" || raw === "1" || raw === "0") {
        return raw === "true" || raw === "1" ? "true" : "false";
      }
      return null;
    }
    case "outreach.daily_discovery_limit":
    case "outreach.daily_invitation_limit":
    case "outreach.min_score":
    case "outreach.run_local_hour": {
      const numeric = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
      if (!Number.isFinite(numeric)) return null;
      const int = Math.round(numeric);

      if (key === "outreach.daily_discovery_limit") {
        if (int < 0 || int > MAX_DAILY_DISCOVERY_LIMIT) return null;
      } else if (key === "outreach.daily_invitation_limit") {
        if (int < 0 || int > MAX_DAILY_INVITATION_LIMIT) return null;
      } else if (key === "outreach.min_score") {
        if (int < 0 || int > 100) return null;
      } else if (int < 0 || int > 23) {
        return null;
      }

      return String(int);
    }
    case "outreach.timezone": {
      if (typeof raw !== "string") return null;
      const normalized = normalizeTimeZone(raw.trim());
      return normalized;
    }
    case "outreach.feed_url": {
      if (typeof raw !== "string") return null;
      const trimmed = raw.trim();
      if (trimmed.length === 0) return "";
      if (trimmed.length > 2000) return null;
      try {
        const url = new URL(trimmed);
        if (url.protocol !== "https:") return null;
        return trimmed;
      } catch {
        return null;
      }
    }
    case "outreach.channel_url": {
      // Same rules as the feed: https or empty. Never a fabricated default.
      if (typeof raw !== "string") return null;
      const trimmed = raw.trim();
      if (trimmed.length === 0) return "";
      if (trimmed.length > 500) return null;
      try {
        const url = new URL(trimmed);
        if (url.protocol !== "https:") return null;
        return url.toString();
      } catch {
        return null;
      }
    }
    case "outreach.cities_enabled":
    case "outreach.cities_disabled": {
      const normalized = normalizeCityCodeList(raw, MAX_CAMPAIGN_CITIES);
      if (normalized === null) return null;
      return normalized.join(",");
    }
    default:
      return null;
  }
}

const SETTINGS_READ_ERROR =
  "Outreach settings could not be read. Check the database and retry; approval and delivery are paused.";

export async function getOutreachSettings(): Promise<OutreachSettings> {
  let rows: Array<{ key: string; value: string }> = [];

  try {
    rows = await prisma.adminSetting.findMany({
      where: { key: { in: [...OUTREACH_SETTING_KEYS] } },
      select: { key: true, value: true },
    });
  } catch {
    // Permission to send must never be inferred from a failed settings read.
    return {
      ...DEFAULT_OUTREACH_SETTINGS,
      enabled: false,
      autoSendEnabled: false,
      sources: { enabled: "error", autoSendEnabled: "error" },
      warnings: [SETTINGS_READ_ERROR],
      readError: SETTINGS_READ_ERROR,
    };
  }

  const map = new Map(rows.map((row) => [row.key, row.value]));

  const enabledSwitch = readKillSwitch("outreach.enabled", map.get("outreach.enabled"));
  const autoSendSwitch = readKillSwitch(
    "outreach.auto_send_enabled",
    map.get("outreach.auto_send_enabled")
  );

  return {
    enabled: enabledSwitch.value,
    autoSendEnabled: autoSendSwitch.value,
    dailyDiscoveryLimit: readInt(
      map.get("outreach.daily_discovery_limit"),
      DEFAULT_OUTREACH_SETTINGS.dailyDiscoveryLimit,
      0,
      MAX_DAILY_DISCOVERY_LIMIT
    ),
    dailyInvitationLimit: readInt(
      map.get("outreach.daily_invitation_limit"),
      DEFAULT_OUTREACH_SETTINGS.dailyInvitationLimit,
      0,
      MAX_DAILY_INVITATION_LIMIT
    ),
    timezone: normalizeTimeZone(map.get("outreach.timezone") ?? "") ?? "UTC",
    runLocalHour: readInt(map.get("outreach.run_local_hour"), DEFAULT_OUTREACH_SETTINGS.runLocalHour, 0, 23),
    feedUrl: map.get("outreach.feed_url") ?? "",
    feedEnabled: readBoolean(map.get("outreach.feed_enabled"), false),
    minScore: readInt(map.get("outreach.min_score"), DEFAULT_OUTREACH_SETTINGS.minScore, 0, 100),
    channelUrl: map.get("outreach.channel_url") ?? "",
    sources: {
      enabled: enabledSwitch.source,
      autoSendEnabled: autoSendSwitch.source,
    },
    warnings: [enabledSwitch.warning, autoSendSwitch.warning].filter(
      (value): value is string => typeof value === "string"
    ),
  };
}

export type OutreachDeliveryGate =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * The single kill-switch check used before anything that can leave the
 * platform. Re-read at the server-side boundary, immediately before the
 * operation — never cached from an earlier step in the same request.
 */
export function outreachDeliveryGate(
  settings: OutreachSettings
): OutreachDeliveryGate {
  if (settings.readError) return { ok: false, reason: settings.readError };
  if (!settings.enabled) {
    return {
      ok: false,
      reason:
        "Outreach is globally disabled (outreach.enabled is not set to true). Approval and delivery are paused.",
    };
  }
  if (!settings.autoSendEnabled) {
    return {
      ok: false,
      reason:
        "Automatic delivery is off (outreach.auto_send_enabled is not set to true). Nothing is sent.",
    };
  }
  return { ok: true };
}

/** Read the effective settings and evaluate the kill switch in one step. */
export async function currentOutreachDeliveryGate(): Promise<OutreachDeliveryGate> {
  return outreachDeliveryGate(await getOutreachSettings());
}

/** A failed market-approval read must not re-enable a disabled city. */
export async function getCityApprovalOverrides(): Promise<{
  enabled: string[];
  disabled: string[];
}> {
  let rows: Array<{ key: string; value: string }> = [];
  try {
    rows = await prisma.adminSetting.findMany({
      where: {
        key: { in: ["outreach.cities_enabled", "outreach.cities_disabled"] },
      },
      select: { key: true, value: true },
    });
  } catch {
    throw new Error("Approved markets could not be read. Outreach targeting is paused; check database settings.");
  }

  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    enabled: normalizeCityCodeList(map.get("outreach.cities_enabled") ?? "", MAX_CAMPAIGN_CITIES) ?? [],
    disabled: normalizeCityCodeList(map.get("outreach.cities_disabled") ?? "", MAX_CAMPAIGN_CITIES) ?? [],
  };
}

export async function setOutreachSetting(
  key: OutreachSettingKey,
  raw: unknown
): Promise<boolean> {
  const value = coerceSettingValue(key, raw);
  if (value === null) return false;

  await prisma.adminSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });

  return true;
}

/**
 * Apply a hard cap to a requested quota change. The system never raises its own
 * limits — only an administrator can, and never above the guard rails above.
 */
export function clampDiscoveryLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DAILY_DISCOVERY_LIMIT;
  return Math.min(MAX_DAILY_DISCOVERY_LIMIT, Math.max(0, Math.round(value)));
}

export function clampInvitationLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DAILY_INVITATION_LIMIT;
  return Math.min(MAX_DAILY_INVITATION_LIMIT, Math.max(0, Math.round(value)));
}

/**
 * The calendar date (YYYY-MM-DD) that the daily run should be filed under, in
 * the configured timezone. This makes run identity and reporting stable even
 * though Vercel Cron always fires in UTC.
 */
export function runDateFor(timezone: string, now = new Date()): string {
  const safeTimezone = normalizeTimeZone(timezone) ?? "UTC";
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: safeTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
