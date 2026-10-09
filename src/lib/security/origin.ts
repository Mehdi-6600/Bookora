import type { NextRequest } from "next/server";

function addOrigin(target: Set<string>, value: string | null | undefined): void {
  if (!value) return;
  try {
    target.add(new URL(value).origin);
  } catch {
    // Ignore malformed proxy/application URLs.
  }
}

function normalizedHost(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Protect browser-facing state changes from cross-origin form/fetch requests.
 *
 * Security note: `Origin` is set by the browser and cannot be forged by page
 * JavaScript, but `X-Forwarded-Host` / `X-Forwarded-Proto` are ordinary request
 * headers. They must therefore never be able to introduce an *extra* trusted
 * origin, otherwise any cross-site POST could add its own domain to the
 * allow-list and defeat this check. They are only honored when the proxy did
 * not replace the authority of the request URL itself (i.e. both describe the
 * same host), so a reverse proxy in front of the app keeps working.
 */
export function hasTrustedOrigin(request: NextRequest): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader || originHeader === "null") return false;

  let origin: string;
  let requestUrl: URL;
  try {
    origin = new URL(originHeader).origin;
    requestUrl = new URL(request.url);
  } catch {
    return false;
  }

  const allowed = new Set<string>();
  allowed.add(requestUrl.origin);

  const requestHost = normalizedHost(requestUrl.host);
  const forwardedHost = normalizedHost(
    request.headers.get("x-forwarded-host")?.split(",")[0]
  );
  const hostHeader = normalizedHost(request.headers.get("host"));
  const protocol = requestUrl.protocol.replace(":", "");

  // Only consider proxy headers when they agree with the authority of the
  // request URL. A mismatching value is attacker-controlled and is discarded.
  const proxyMatchesRequest =
    forwardedHost !== null &&
    requestHost !== null &&
    (forwardedHost === requestHost || forwardedHost === hostHeader);

  if (proxyMatchesRequest && (protocol === "http" || protocol === "https")) {
    allowed.add(`${protocol}://${forwardedHost}`);
  }

  addOrigin(allowed, process.env.APP_URL);
  return allowed.has(origin);
}
