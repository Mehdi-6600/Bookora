import { afterEach, describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

afterEach(() => vi.unstubAllEnvs());

describe("SEO discovery metadata", () => {
  it("lists the public home and each sector page in all supported locales", () => {
    vi.stubEnv("APP_URL", "https://bookora.example/");

    const entries = sitemap();
    expect(entries).toHaveLength(15);
    expect(entries.map((entry) => entry.url)).toContain(
      "https://bookora.example/for/barbers"
    );
    expect(entries.map((entry) => entry.url)).toContain("https://bookora.example/fa");
    expect(entries.map((entry) => entry.url)).toContain(
      "https://bookora.example/fa/for/clinics"
    );
    expect(entries.map((entry) => entry.url)).toContain(
      "https://bookora.example/ar/for/salons"
    );
    expect(entries.every((entry) => entry.url.startsWith("https://bookora.example/"))).toBe(
      true
    );
  });

  it("publishes the sitemap and excludes private app/admin/API paths from crawling", () => {
    vi.stubEnv("APP_URL", "https://bookora.example");

    const result = robots();
    expect(result.sitemap).toBe("https://bookora.example/sitemap.xml");
    expect(result.rules).toEqual({
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin",
        "/app",
        "/fa/admin",
        "/fa/app",
        "/ar/admin",
        "/ar/app",
      ],
    });
  });
});
