import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { hasTrustedOrigin } from "@/lib/security/origin";

const intlMiddleware = createMiddleware(routing);
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_EXEMPT_PATHS = new Set(["/api/telegram/webhook"]);

export default function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    if (
      MUTATING_METHODS.has(request.method) &&
      !CSRF_EXEMPT_PATHS.has(request.nextUrl.pathname) &&
      !hasTrustedOrigin(request)
    ) {
      return NextResponse.json(
        { error: "Cross-origin request rejected." },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.next();
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)", "/api/:path*"],
};
