import type { NextRequest } from "next/server";

function addOrigin(target: Set<string>, value: string | null | undefined): void {
  if (!value) return;
  try {
    target.add(new URL(value).origin);
  } catch {
    // Ignore malformed proxy/application URLs.
  }
}

/** Protect browser-facing state changes from cross-origin form/fetch requests. */
export function hasTrustedOrigin(request: NextRequest): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader || originHeader === "null") return false;

  let origin: string;
  try {
    origin = new URL(originHeader).origin;
  } catch {
    return false;
  }

  const allowed = new Set<string>();
  addOrigin(allowed, request.url);

  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const host = forwardedHost || request.headers.get("host");
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const protocol = forwardedProto || new URL(request.url).protocol.replace(":", "");
  if (host && (protocol === "http" || protocol === "https")) {
    addOrigin(allowed, `${protocol}://${host}`);
  }

  addOrigin(allowed, process.env.APP_URL);
  return allowed.has(origin);
}
