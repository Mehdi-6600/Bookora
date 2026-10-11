import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { webhookCallback } from "grammy";
import { getBot } from "@/lib/telegram/bot";
import { env } from "@/lib/env";
import { BotUpdateRejected } from "@/lib/outreach/bot-consent";

const handleUpdate = webhookCallback(getBot(), "std/http");

/**
 * Telegram's documented webhook security model: when `setWebhook` is called
 * with a `secret_token`, every update carries that value in the
 * `X-Telegram-Bot-Api-Secret-Token` header. Anything else is rejected before
 * it can reach a handler, so no request can fabricate outreach consent.
 */
function hasValidWebhookSecret(req: NextRequest): boolean {
  const expected = env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || expected.length < 32) return false;
  const supplied = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

export async function POST(req: NextRequest) {
  if (!env.TELEGRAM_WEBHOOK_SECRET || env.TELEGRAM_WEBHOOK_SECRET.length < 32) {
    return NextResponse.json(
      { error: "Telegram webhook authentication is not configured." },
      { status: 503 }
    );
  }

  if (!hasValidWebhookSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return await handleUpdate(req);
  } catch (error) {
    // An update that can never be valid (wrong chat type, malformed ids) is
    // acknowledged so Telegram stops retrying it. Everything else stays 5xx so
    // transient database or handler failures are retried.
    if (error instanceof BotUpdateRejected) {
      console.error("Telegram webhook rejected an invalid update:", error.name);
      return NextResponse.json({ ok: false, rejected: true }, { status: 200 });
    }

    console.error(
      "Telegram webhook handling failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
