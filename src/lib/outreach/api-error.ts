import { NextResponse } from "next/server";
import { AuditUnavailableError } from "@/lib/outreach/audit";

/** Never return a success for an unknown database/audit failure. */
export function withOutreachError<T extends (...args: any[]) => Promise<NextResponse>>(handler: T): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error("Outreach operation failed:", error instanceof Error ? error.name : "UnknownError");
      return NextResponse.json({
        error: error instanceof AuditUnavailableError
          ? error.message
          : "Outreach storage is unavailable. Refresh the current state and audit history before retrying; never blindly retry a SENDING invitation.",
      }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  }) as T;
}
