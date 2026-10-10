import { prisma } from "@/lib/prisma";

/**
 * Audit trail for important outreach state changes.
 *
 * Every function here is FAIL-SOFT by contract: the audit table is additive
 * (prisma/sql/0003_outreach_audit.sql) and may not exist yet on a deployed
 * database that has not run `npm run db:push`. Audit logging must never be
 * the reason a review, approval or preparation action fails — so all errors
 * are swallowed here and reads degrade to an empty list.
 *
 * Content policy: `action` values are stable machine names; `detail` carries
 * short summaries only (counts, statuses). No message bodies, no business
 * contacts, no credentials, no URLs with userinfo.
 */

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
}): Promise<void> {
  try {
    await prisma.outreachAuditEvent.create({
      data: {
        scope: event.scope,
        entityId: event.entityId ?? null,
        action: event.action.slice(0, 80),
        actorUserId: event.actorUserId ?? null,
        detail: sanitizeAuditDetail(event.detail),
      },
    });
  } catch {
    // Missing table / transient DB error: auditing is best-effort by design.
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
    return [];
  }
}
