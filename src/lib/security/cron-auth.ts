import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

/**
 * Shared authorization for scheduled endpoints.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. The secret must be at
 * least 32 characters, and the comparison is constant time. Exported so the
 * behaviour can be unit tested without a running server.
 */
export const CRON_SECRET_MIN_LENGTH = 32;

export function isCronSecretConfigured(secret: string | undefined): boolean {
  return typeof secret === "string" && secret.length >= CRON_SECRET_MIN_LENGTH;
}

export function hasValidCronAuthorization(
  request: { headers: Headers },
  secret: string | undefined = process.env.CRON_SECRET
): boolean {
  if (!isCronSecretConfigured(secret)) return false;

  const supplied = request.headers.get("authorization") ?? "";
  const expectedBuffer = Buffer.from(`Bearer ${secret}`);
  const suppliedBuffer = Buffer.from(supplied);

  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}
