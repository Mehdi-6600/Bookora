import { z } from "zod";

const serverSchema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_BOT_USERNAME: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1).optional(),
  ADMIN_TELEGRAM_IDS: z.string().optional(),
  APP_URL: z.string().url(),
  BOT_USERNAME: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
}).superRefine((values, context) => {
  if (values.NODE_ENV !== "production") return;

  let protocol: string;
  try {
    protocol = new URL(values.APP_URL).protocol;
  } catch {
    return; // The URL validator reports malformed values separately.
  }

  if (protocol !== "https:") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["APP_URL"],
      message: "APP_URL must use HTTPS in production.",
    });
  }
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
  JWT_SECRET: process.env.JWT_SECRET,
  NODE_ENV: process.env.NODE_ENV,
});

if (!serverEnv.success) {
  console.error(
    "❌ Invalid server env:",
    serverEnv.error.flatten().fieldErrors
  );
  throw new Error("Invalid server environment variables");
}

export const env = serverEnv.data;

export const adminTelegramIdsConfigured = env.ADMIN_TELEGRAM_IDS !== undefined;

export const adminTelegramIds: bigint[] = (env.ADMIN_TELEGRAM_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter((id) => id.length > 0)
  .flatMap((id) => {
    try {
      return [BigInt(id)];
    } catch {
      console.error("Invalid ADMIN_TELEGRAM_IDS entry ignored.");
      return [];
    }
  });
