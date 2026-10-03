import { createHash, randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";

// Fixed-window counters live in PostgreSQL so limits are shared across
// serverless instances. The UPSERT increments atomically, including the first
// concurrent requests in a window.
export async function isRateLimited(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
    return true;
  }

  const now = new Date();
  const newExpiresAt = new Date(now.getTime() + windowMs);
  const hashedKey = createHash("sha256").update(key).digest("hex");

  try {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "rate_limits" ("id", "key", "count", "expiresAt")
      VALUES (${randomUUID()}, ${hashedKey}, 1, ${newExpiresAt})
      ON CONFLICT ("key") DO UPDATE
      SET
        "count" = CASE
          WHEN "rate_limits"."expiresAt" <= ${now} THEN 1
          ELSE "rate_limits"."count" + 1
        END,
        "expiresAt" = CASE
          WHEN "rate_limits"."expiresAt" <= ${now} THEN ${newExpiresAt}
          ELSE "rate_limits"."expiresAt"
        END
      RETURNING "count"
    `;

    return !rows[0] || rows[0].count > limit;
  } catch (error) {
    // For abuse-sensitive routes fail closed: database failures must not turn
    // rate limiting into an unauthenticated unlimited path.
    console.error(
      "Rate-limit counter unavailable:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return true;
  }
}

// Clean expired counters opportunistically without adding a memory-only lock.
export function triggerRateLimitCleanup(): void {
  if (Math.random() > 0.01) return;

  void prisma.rateLimit
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {
      // Cleanup is opportunistic and must not affect the protected request.
    });
}
