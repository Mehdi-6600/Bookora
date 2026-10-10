import type { FunnelEventName } from "@/lib/funnel";

/**
 * Browser-side funnel tracking.
 *
 * Sends only an event name, the current locale and an optional non-personal
 * reference code (campaign / prospect attribution code). No identity, no
 * cookies and no personal data leave the browser.
 */

const ENDPOINT = "/api/funnel";

function safeRef(value: string | null | undefined): string | null {
  if (!value) return null;
  // Only simple, non-personal attribution tokens are accepted.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) return null;
  return value;
}

export function track(
  event: FunnelEventName,
  options?: { ref?: string | null; locale?: string | null }
): void {
  if (typeof window === "undefined") return;

  const payload = JSON.stringify({
    event,
    locale: options?.locale ?? document.documentElement.lang ?? null,
    ref: safeRef(options?.ref),
  });

  try {
    // `sendBeacon` survives page navigation, which matters for the "start
    // click" step that immediately leaves the landing page.
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }

    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
      cache: "no-store",
    }).catch(() => {
      // Analytics failures are intentionally silent.
    });
  } catch {
    // Ignore: tracking must never break the UI.
  }
}

/** Read the attribution reference from the current URL (`?ref=` / `start_param`). */
export function readRefFromLocation(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const params = new URLSearchParams(window.location.search);
    return safeRef(params.get("ref") ?? params.get("start_param"));
  } catch {
    return null;
  }
}
