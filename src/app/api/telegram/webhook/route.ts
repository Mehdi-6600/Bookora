import { NextRequest, NextResponse } from "next/server";
import { webhookCallback } from "grammy";
import { getBot } from "@/lib/telegram/bot";
import { env } from "@/lib/env";

const handleUpdate = webhookCallback(getBot(), "std/http");

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");

  if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return await handleUpdate(req);
  } catch (error) {
    console.error("Telegram webhook handling failed:", error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
