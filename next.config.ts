import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const FRAME_ANCESTORS =
  "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org;";

const BASE_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const BASE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://telegram.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.telegram.org",
  FRAME_ANCESTORS,
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "t.me" },
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: BASE_SECURITY_HEADERS,
      },
      {
        source: "/((?!api|_next|_vercel|.*\\..*).*)",
        headers: [
          { key: "Content-Security-Policy", value: BASE_CSP },
        ],
      },
      {
        source: "/:locale/app",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, max-age=0",
          },
          { key: "Content-Security-Policy", value: BASE_CSP },
        ],
      },
      {
        source: "/:locale/app/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, max-age=0",
          },
          { key: "Content-Security-Policy", value: BASE_CSP },
        ],
      },
      {
        source: "/:locale/admin",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, max-age=0",
          },
          { key: "Content-Security-Policy", value: BASE_CSP },
        ],
      },
      {
        source: "/:locale/admin/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, max-age=0",
          },
          { key: "Content-Security-Policy", value: BASE_CSP },
        ],
      },
      {
        source: "/:locale/book/:path*",
        headers: [
          { key: "Content-Security-Policy", value: BASE_CSP },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
