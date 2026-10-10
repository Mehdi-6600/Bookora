import { withOutreachError } from "@/lib/outreach/api-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { saveCampaignMessage } from "@/lib/outreach/campaigns";
import { composeCampaignMessage } from "@/lib/outreach/message";
import { getOutreachSettings } from "@/lib/outreach/settings";

/**
 * Campaign message builder endpoint.
 *
 * PATCH saves the edited invitation text + destination selection for a
 * campaign that is still DRAFT/REVIEW (the message is frozen after approval,
 * exactly like targeting). The stored result is a campaign-scoped invitation
 * template, so the existing preparation pipeline renders precisely the
 * previewed body — no second message path.
 *
 * Preview-only round-trips (validation without saving) use the same pure
 * composer the UI calls locally; this endpoint re-validates server-side.
 */

type Params = { params: Promise<{ id: string }> };

const messageSchema = z.object({
  message: z.string().max(4000),
  language: z.string().trim().max(8).optional(),
  cta: z.string().trim().max(200).nullable().optional(),
  destinations: z
    .object({
      bot: z.boolean().default(false),
      channel: z.boolean().default(false),
      other: z.boolean().default(false),
    })
    .nullable()
    .optional(),
  destinationUrl: z.string().trim().max(500).nullable().optional(),
});

async function PATCHImpl(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (
    await isRateLimited(`outreach-message:${guard.user.id}`, 60, 10 * 60 * 1000)
  ) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  triggerRateLimitCleanup();

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid message", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await saveCampaignMessage(
    id,
    {
      message: parsed.data.message,
      language: parsed.data.language,
      cta: parsed.data.cta ?? null,
      destinations: parsed.data.destinations ?? null,
      destinationUrl: parsed.data.destinationUrl ?? null,
    },
    guard.user.id
  );

  if (!result.ok) {
    return NextResponse.json({ error: "message rejected", errors: result.errors }, { status: 400 });
  }

  return NextResponse.json(result);
}

/**
 * POST = validate-only ("preview") — never writes. The UI mostly composes
 * locally with the shared pure module; this exists so an explicit server-side
 * check (with the deployment's real settings) can be requested at any time.
 */
async function POSTImpl(req: NextRequest, _params: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = messageSchema.pick({ message: true, destinations: true, cta: true, destinationUrl: true }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const settings = await getOutreachSettings();
  const composed = composeCampaignMessage({
    message: parsed.data.message,
    cta: parsed.data.cta ?? null,
    destinations: parsed.data.destinations ?? null,
    channelUrl: settings.channelUrl,
    otherUrl: parsed.data.destinationUrl ?? null,
  });

  return NextResponse.json({
    ok: composed.errors.length === 0,
    body: composed.body,
    links: composed.links,
    errors: composed.errors,
  });
}

export const PATCH = withOutreachError(PATCHImpl);
export const POST = withOutreachError(POSTImpl);
