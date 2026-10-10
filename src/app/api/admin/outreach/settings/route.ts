import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { recordAuditEvent } from "@/lib/outreach/audit";
import {
  isOutreachSettingKey,
  OUTREACH_SETTING_KEYS,
  setOutreachSetting,
  getOutreachSettings,
  MAX_DAILY_DISCOVERY_LIMIT,
  MAX_DAILY_INVITATION_LIMIT,
} from "@/lib/outreach/settings";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const settings = await getOutreachSettings();

  return NextResponse.json(
    {
      settings,
      keys: OUTREACH_SETTING_KEYS,
      limits: {
        maxDailyDiscoveryLimit: MAX_DAILY_DISCOVERY_LIMIT,
        maxDailyInvitationLimit: MAX_DAILY_INVITATION_LIMIT,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function PUT(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-settings:${guard.user.id}`, 60, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  triggerRateLimitCleanup();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const invalid: string[] = [];

  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!isOutreachSettingKey(key)) {
      invalid.push(key);
      continue;
    }
    const ok = await setOutreachSetting(key, value);
    if (!ok) invalid.push(key);
  }

  if (invalid.length > 0) {
    return NextResponse.json(
      { error: "invalid settings", invalid },
      { status: 400 }
    );
  }

  // Audit which switches moved (keys only — never values, so nothing sensitive
  // is persisted twice) and whether this was the global pause.
  const notable = Object.keys(body as Record<string, unknown>).filter(
    (key) =>
      key === "outreach.enabled" ||
      key === "outreach.auto_send_enabled" ||
      key === "outreach.channel_url" ||
      key === "outreach.cities_enabled" ||
      key === "outreach.cities_disabled"
  );
  if (notable.length > 0) {
    await recordAuditEvent({
      scope: "settings",
      action: notable.includes("outreach.enabled") || notable.includes("outreach.auto_send_enabled")
        ? "settings.pause_changed"
        : notable.includes("outreach.channel_url")
          ? "settings.channel_url_changed"
          : "cities.approval_changed",
      actorUserId: guard.user.id,
      // Keys only: setting values (including public URLs) belong in the
      // settings table, not duplicated into free-form audit details.
      detail: `keys=${notable.join(",")}`,
    });
  }

  const settings = await getOutreachSettings();
  return NextResponse.json({ settings });
}

/**
 * Manual seed list for the `manual` discovery source.
 *
 * The administrator pastes PUBLIC business pages they have verified. This is
 * the only discovery input that works out of the box; no scraping is involved.
 */
const SEED_KEY = "outreach.manual_seed";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-seed:${guard.user.id}`, 60, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  triggerRateLimitCleanup();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items)) {
    return NextResponse.json(
      { error: "items must be an array of {publicName, publicUrl}" },
      { status: 400 }
    );
  }

  const cleaned = items
    .slice(0, 1000)
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const row = entry as Record<string, unknown>;
      const publicName =
        typeof row.publicName === "string" ? row.publicName.trim().slice(0, 200) : "";
      if (!publicName) return null;

      return {
        publicName,
        publicUrl:
          typeof row.publicUrl === "string" ? row.publicUrl.trim().slice(0, 500) : null,
        telegramUsername:
          typeof row.telegramUsername === "string"
            ? row.telegramUsername.trim().slice(0, 64)
            : null,
        description:
          typeof row.description === "string"
            ? row.description.trim().slice(0, 800)
            : null,
        city: typeof row.city === "string" ? row.city.trim().slice(0, 80) : null,
        language: typeof row.language === "string" ? row.language.trim().slice(0, 8) : null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  await prisma.adminSetting.upsert({
    where: { key: SEED_KEY },
    update: { value: JSON.stringify(cleaned) },
    create: { key: SEED_KEY, value: JSON.stringify(cleaned) },
  });

  return NextResponse.json({ saved: cleaned.length });
}
