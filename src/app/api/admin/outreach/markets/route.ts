import { withOutreachError } from "@/lib/outreach/api-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_APPROVED_CITIES,
  cityDefinition,
  mergeApprovedCities,
} from "@/lib/outreach/city-registry";
import { recordAuditEvent } from "@/lib/outreach/audit";

/**
 * Market approval — the ONLY way a city becomes targetable beyond the four
 * launch cities. There is no bulk "enable everything": each approval is an
 * explicit administrator action, stored as minimal overrides in
 * `admin_settings` (no schema change), and audit-logged.
 *
 * Approving a market enables campaign targeting ONLY. It creates no
 * prospects, starts no outreach and sends nothing.
 */

async function currentApproved(): Promise<string[]> {
  const rows = await prisma.adminSetting.findMany({
    where: { key: { in: ["outreach.cities_enabled", "outreach.cities_disabled"] } },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const list = (key: string) =>
    (map.get(key) ?? "")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter((value) => value.length > 0);
  return mergeApprovedCities(list("outreach.cities_enabled"), list("outreach.cities_disabled"));
}

async function PUTImpl(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-markets:${guard.user.id}`, 120, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  triggerRateLimitCleanup();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = z
    .object({
      code: z.string().trim().min(3).max(40),
      approved: z.boolean(),
    })
    .safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const code = parsed.data.code.trim().toUpperCase();
  if (!cityDefinition(code)) {
    return NextResponse.json(
      { error: "unknown city code", hint: "Add the city to the market registry first." },
      { status: 400 }
    );
  }

  const approved = await currentApproved();
  const desired = new Set(approved);
  if (parsed.data.approved) desired.add(code);
  else desired.delete(code);

  // Store MINIMAL overrides: enables beyond the defaults, disables of defaults.
  const defaults = new Set(DEFAULT_APPROVED_CITIES);
  const enabledExtra = [...desired].filter((item) => !defaults.has(item));
  const disabledDefaults = [...defaults].filter((item) => !desired.has(item));

  await prisma.$transaction(async (tx) => {
    const upsert = (key: string, value: string) => tx.adminSetting.upsert({
      where: { key }, update: { value },
      create: { key, value, description: "Outreach market approval" },
    });
    await upsert("outreach.cities_enabled", enabledExtra.join(","));
    await upsert("outreach.cities_disabled", disabledDefaults.join(","));
    await recordAuditEvent({ scope: "cities", entityId: code,
      action: parsed.data.approved ? "cities.approved" : "cities.disabled",
      actorUserId: guard.user.id, detail: `count=${desired.size}` }, tx);
  });

  return NextResponse.json({ ok: true, approved: [...desired] });
}

export const PUT = withOutreachError(PUTImpl);
