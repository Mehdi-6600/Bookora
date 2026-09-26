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

export function validateInitData(initData: string): ValidatedInitData {
  if (!initData || typeof initData !== "string") {
    throw new Error("initData is empty");
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("Missing hash");

  params.delete("hash");

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  // DEBUG: چاپ طول توکن و کاراکترهای اول
  console.log("DEBUG TOKEN LENGTH:", env.TELEGRAM_BOT_TOKEN.length);
  console.log("DEBUG TOKEN FIRST 10:", env.TELEGRAM_BOT_TOKEN.substring(0, 10));
  console.log("DEBUG TOKEN LAST 5:", env.TELEGRAM_BOT_TOKEN.slice(-5));
  console.log("DEBUG HASH FROM TG:", hash);
  console.log("DEBUG DATA CHECK STRING:", dataCheckString.substring(0, 200));

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(env.TELEGRAM_BOT_TOKEN)
    .digest();

  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  console.log("DEBUG COMPUTED HASH:", computedHash);

  if (computedHash !== hash) {
    throw new Error(
      `Invalid initData hash (tokenLength=${env.TELEGRAM_BOT_TOKEN.length}, tokenStart=${env.TELEGRAM_BOT_TOKEN.substring(0, 10)})`
    );
  }

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate) throw new Error("Missing auth_date");

  const MAX_AGE_SECONDS = 60 * 60 * 24;
  const now = Math.floor(Date.now() / 1000);
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

  if (!user.id) throw new Error("Invalid user");

  return {
    user,
    authDate,
    queryId: params.get("query_id") ?? undefined,
    raw: params,
  };
}
