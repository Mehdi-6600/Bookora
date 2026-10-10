import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getBot, BOT_COMMANDS } from "@/lib/telegram/bot";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { miniAppUrl, START_BUTTON } from "@/lib/telegram/onboarding";

const WEBHOOK_PATH = "/api/telegram/webhook";

function webhookUrl(): string {
  return `${env.APP_URL.replace(/\/+$/, "")}${WEBHOOK_PATH}`;
}

/** Show the current Telegram-side configuration so setup can be verified. */
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const secretConfigured =
    Boolean(env.TELEGRAM_WEBHOOK_SECRET) &&
    (env.TELEGRAM_WEBHOOK_SECRET?.length ?? 0) >= 32;

  if (!secretConfigured) {
    return NextResponse.json(
      {
        configured: false,
        reason:
          "TELEGRAM_WEBHOOK_SECRET is missing or shorter than 32 characters. The webhook route rejects all requests until it is set.",
        expectedUrl: webhookUrl(),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const info = await getBot().api.getWebhookInfo();
    return NextResponse.json(
      {
        configured: true,
        expectedUrl: webhookUrl(),
        info: {
          url: info.url,
          has_custom_certificate: info.has_custom_certificate,
          pending_update_count: info.pending_update_count,
          last_error_date: info.last_error_date,
          last_error_message: info.last_error_message,
          max_connections: info.max_connections,
          allowed_updates: info.allowed_updates,
        },
        matchesExpected: info.url === webhookUrl(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error(
      "getWebhookInfo failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "Could not reach the Telegram Bot API." },
      { status: 502 }
    );
  }
}

/**
 * Register the webhook, the command list and the persistent Mini App button.
 *
 * This is a manual, admin-triggered action by design: it is the one step that
 * must be verified against the live bot before outreach starts.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`telegram-webhook:${guard.user.id}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  triggerRateLimitCleanup();

  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) {
    return NextResponse.json(
      {
        error:
          "TELEGRAM_WEBHOOK_SECRET is not configured (minimum 32 characters). Add it to the Vercel environment variables and redeploy.",
      },
      { status: 503 }
    );
  }

  // `drop_pending_updates` is opt-in so a routine re-register never discards
  // real customer messages.
  const dropPending =
    req.nextUrl.searchParams.get("dropPending") === "true";

  try {
    const bot = getBot();

    await bot.api.setWebhook(webhookUrl(), {
      secret_token: secret,
      drop_pending_updates: dropPending,
      allowed_updates: ["message", "pre_checkout_query", "callback_query"],
    });

    await bot.api.setMyCommands([...BOT_COMMANDS]);

    // Persistent Mini App button in the composer — this is how a business
    // owner opens Bookora after the first /start.
    await bot.api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: START_BUTTON.en,
        web_app: { url: miniAppUrl("en") },
      },
    });

    const info = await bot.api.getWebhookInfo();

    return NextResponse.json(
      {
        ok: true,
        webhookUrl: webhookUrl(),
        commands: BOT_COMMANDS,
        miniAppUrl: miniAppUrl("en"),
        info: {
          url: info.url,
          pending_update_count: info.pending_update_count,
          last_error_message: info.last_error_message,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error(
      "setWebhook failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "Telegram rejected the configuration request." },
      { status: 502 }
    );
  }
}
