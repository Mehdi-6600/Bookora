import { describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";
import { hasTrustedOrigin } from "@/lib/security/origin";

function makeRequest(
  url: string,
  headers: Record<string, string>
): NextRequest {
  const lower = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    url,
    headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null },
  } as unknown as NextRequest;
}

describe("hasTrustedOrigin", () => {
  it("accepts the same origin", () => {
    expect(
      hasTrustedOrigin(
        makeRequest("https://bookora.app/api/x", {
          origin: "https://bookora.app",
        })
      )
    ).toBe(true);
  });

  it("rejects a foreign origin", () => {
    expect(
      hasTrustedOrigin(
        makeRequest("https://bookora.app/api/x", {
          origin: "https://evil.com",
        })
      )
    ).toBe(false);
  });

  it("rejects a missing origin", () => {
    expect(
      hasTrustedOrigin(makeRequest("https://bookora.app/api/x", {}))
    ).toBe(false);
  });

  it("does not let X-Forwarded-Host forge a trusted origin", () => {
    // A hostile client can set X-Forwarded-* itself, so these must never be
    // able to make an attacker origin look like this deployment.
    expect(
      hasTrustedOrigin(
        makeRequest("https://bookora.app/api/x", {
          origin: "https://evil.com",
          "x-forwarded-host": "evil.com",
          "x-forwarded-proto": "https",
          host: "bookora.app",
        })
      )
    ).toBe(false);
  });

  it("still accepts the real deployment host behind a proxy", () => {
    expect(
      hasTrustedOrigin(
        makeRequest("https://bookora.app/api/x", {
          origin: "https://bookora.app",
          host: "bookora.app",
        })
      )
    ).toBe(true);
  });
});
