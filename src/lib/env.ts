import { z } from "zod";

const serverEnvFields = {
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
};

const serverEnvSchema = z
  .object(serverEnvFields)
  .superRefine((values, context) => {
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

export type ServerEnv = z.infer<typeof serverEnvSchema>;
type ServerEnvKey = keyof ServerEnv;

function rawServerEnv() {
  return {
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
  };
}

export class ServerEnvValidationError extends Error {
  constructor() {
    super("Invalid server environment variables");
    this.name = "ServerEnvValidationError";
  }
}

function rejectInvalidServerEnv(fieldErrors: unknown): never {
  // Never print environment values; only Zod's field names and messages.
  console.error("❌ Invalid server env:", fieldErrors);
  throw new ServerEnvValidationError();
}

/**
 * Validate the complete server configuration at runtime. This is intentionally
 * a function (rather than module-initialization work) so Next can import route
 * modules while collecting build metadata without requiring runtime secrets.
 */
export function getServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(rawServerEnv());
  if (!parsed.success) {
    return rejectInvalidServerEnv(parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

function getServerEnvField<K extends ServerEnvKey>(key: K): ServerEnv[K] {
  const parsed = serverEnvFields[key].safeParse(process.env[key]);
  if (!parsed.success) {
    return rejectInvalidServerEnv({
      [key]: parsed.error.issues.map((issue) => issue.message),
    });
  }

  if (key === "APP_URL") {
    const nodeEnv = serverEnvFields.NODE_ENV.safeParse(process.env.NODE_ENV);
    if (!nodeEnv.success) {
      return rejectInvalidServerEnv({
        NODE_ENV: nodeEnv.error.issues.map((issue) => issue.message),
      });
    }

    if (
      nodeEnv.data === "production" &&
      new URL(parsed.data as string).protocol !== "https:"
    ) {
      return rejectInvalidServerEnv({
        APP_URL: ["APP_URL must use HTTPS in production."],
      });
    }
  }

  return parsed.data as ServerEnv[K];
}

/**
 * Individual settings are parsed when consumed. In particular, build-time
 * metadata may read APP_URL without forcing database connection variables to
 * exist during `next build`; Prisma validates the complete environment before
 * its first runtime use.
 */
export const env = new Proxy({} as ServerEnv, {
  get(_target, property) {
    if (
      typeof property !== "string" ||
      !Object.prototype.hasOwnProperty.call(serverEnvFields, property)
    ) {
      return undefined;
    }
    return getServerEnvField(property as ServerEnvKey);
  },
});

export type AdminTelegramConfig = {
  configured: boolean;
  ids: bigint[];
};

export function getAdminTelegramConfig(): AdminTelegramConfig {
  const configuredIds = getServerEnv().ADMIN_TELEGRAM_IDS;
  const ids = (configuredIds ?? "")
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

  return { configured: configuredIds !== undefined, ids };
}
