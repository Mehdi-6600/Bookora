import { NextResponse } from "next/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";

export type AdminGuard =
  | { ok: true; user: CurrentUser }
  | { ok: false; response: NextResponse };

/**
 * Server-side authorization for every `/api/admin/**` route.
 *
 * The check is performed against the signed session cookie and, when
 * `ADMIN_TELEGRAM_IDS` is configured, against that allow-list inside
 * `getCurrentUser()`. Client-side hiding alone would not be authorization.
 */
export async function requireAdmin(): Promise<AdminGuard> {
  let user: CurrentUser | null = null;

  try {
    user = await getCurrentUser();
  } catch {
    user = null;
  }

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!user.isAdmin) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, user };
}

export function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}
