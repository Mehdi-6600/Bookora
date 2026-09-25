import { z } from "zod";

const serverSchema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_BOT_USERNAME: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1).optional(),
  ADMIN_TELEGRAM_IDS: z.string().optional(),
  APP_URL: z.string().url(),
  BOT_USERNAME: z.string().min(1),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const serverEnv = serverSchema.safeParse({
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME,
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
  ADMIN_TELEGRAM_IDS: process.env.ADMIN_TELEGRAM_IDS,
  APP_URL: process.env.APP_URL,
  BOT_USERNAME: process.env.BOT_USERNAME,
  NODE_ENV: process.env.NODE_ENV,
});

if (!serverEnv.success) {
  console.error("❌ Invalid server env:", serverEnv.error.flatten().fieldErrors);
  throw new Error("Invalid server environment variables");
}

export const env = serverEnv.data;

/**
 * لیست آیدی‌های عددی ادمین‌ها به صورت آرایه
 */
export const adminTelegramIds: bigint[] = (env.ADMIN_TELEGRAM_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter((id) => id.length > 0)
  .map((id) => BigInt(id));
