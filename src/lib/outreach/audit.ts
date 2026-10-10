import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/** Required audit events must be written inside the same transaction as the
 * state change. An unavailable audit table is an actionable failure, not success. */
export class AuditUnavailableError extends Error {
  constructor() { super("Audit storage is unavailable; check the database and retry. Required mutations are rolled back."); }
}

export const AUDIT_SCOPES = [
  "campaign",
  "message",
  "settings",
  "cities",
  "invitation",
  "discovery",
  "prospect",
] as const;
export type AuditScope = (typeof AUDIT_SCOPES)[number];

const DETAIL_MAX_LENGTH = 300;

/** Collapse control characters, truncate, and redact credentials in URLs. */
export function sanitizeAuditDetail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const flat = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, DETAIL_MAX_LENGTH);
  if (flat.length === 0) return null;
  return flat.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]*@/gi,
    "$1[redacted]@"
  );
}

export async function recordAuditEvent(event: {
  scope: AuditScope;
  entityId?: string | null;
  action: string;
  actorUserId?: string | null;
  detail?: unknown;
}, db: Prisma.TransactionClient = prisma): Promise<void> {
  try {
    await db.outreachAuditEvent.create({
      data: {
        scope: event.scope,
        entityId: event.entityId ?? null,
        action: event.action.slice(0, 80),
        actorUserId: event.actorUserId ?? null,
        detail: sanitizeAuditDetail(event.detail),
      },
    });
  } catch {
    throw new AuditUnavailableError();
  }
}

export type AuditEventRow = {
  id: string;
  scope: string;
  entityId: string | null;
  action: string;
  actorUserId: string | null;
  detail: string | null;
  createdAt: Date;
};

/** Newest events for one row, e.g. everything that happened on a campaign. */
export async function getAuditEvents(options: {
  scope?: AuditScope;
  entityId?: string | null;
  take?: number;
}): Promise<AuditEventRow[]> {
  try {
    return await prisma.outreachAuditEvent.findMany({
      where: {
        ...(options.scope ? { scope: options.scope } : {}),
        ...(options.entityId ? { entityId: options.entityId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(100, options.take ?? 25)),
    });
  } catch {
    throw new AuditUnavailableError();
  }
}
