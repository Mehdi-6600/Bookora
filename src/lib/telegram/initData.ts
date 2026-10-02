import crypto from "crypto";
import { env } from "@/lib/env";

export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
};

export type ValidatedInitData = {
  user: TelegramUser;
  authDate: number;
  queryId?: string;
  raw: URLSearchParams;
};

// initData باید در این بازه معتبر باشد (۲۴ ساعت).
const MAX_AGE_SECONDS = 60 * 60 * 24;
// clock skew مجاز برای auth_date در آینده (۶۰ ثانیه).
const CLOCK_SKEW_SECONDS = 60;

export function validateInitData(initData: string): ValidatedInitData {
  if (!initData || typeof initData !== "string") {
    throw new Error("initData is empty");
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash || typeof hash !== "string") {
    throw new Error("Missing hash");
  }

  // HMAC-SHA256 در hex دقیقاً ۶۴ کاراکتر است. قبل از مقایسه، طول را چک کن
  // تا از خطای timingSafeEqual جلوگیری شود.
  if (hash.length !== 64 || !/^[0-9a-f]+$/i.test(hash)) {
    throw new Error("Invalid hash format");
  }

  params.delete("hash");

  // طبق مستندات Telegram، ترتیب باید byte-wise باشد، نه locale-aware.
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(env.TELEGRAM_BOT_TOKEN)
    .digest();

  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  // مقایسه‌ی constant-time برای جلوگیری از timing attack.
  const computedBuffer = Buffer.from(computedHash, "hex");
  const providedBuffer = Buffer.from(hash, "hex");

  if (
    computedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(computedBuffer, providedBuffer)
  ) {
    throw new Error("Invalid initData hash");
  }

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw) throw new Error("Missing auth_date");

  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new Error("Invalid auth_date");
  }

  const now = Math.floor(Date.now() / 1000);

  if (authDate > now + CLOCK_SKEW_SECONDS) {
    throw new Error("initData auth_date is in the future");
  }

  if (now - authDate > MAX_AGE_SECONDS) {
    throw new Error("initData expired");
  }

  const userRaw = params.get("user");
  if (!userRaw) throw new Error("Missing user");

  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new Error("Invalid user JSON");
  }

  if (
    !user ||
    typeof user.id !== "number" ||
    !Number.isInteger(user.id) ||
    user.id <= 0
  ) {
    throw new Error("Invalid user id");
  }

  if (user.is_bot === true) {
    throw new Error("Bots are not allowed");
  }

  return {
    user,
    authDate,
    queryId: params.get("query_id") ?? undefined,
    raw: params,
  };
}
