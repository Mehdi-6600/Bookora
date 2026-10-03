import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { webhookCallback } from "grammy";
import { getBot } from "@/lib/telegram/bot";
import { env } from "@/lib/env";

const handleUpdate = webhookCallback(getBot(), "std/http");

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
    console.error(
      "Telegram webhook handling failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    // Return 5xx so Telegram retries transient database or handler failures.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
