import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

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
        // این‌ها روی همه‌ی مسیرها امن هستند و هیچ تداخلی با Embed شدن در تلگرام ندارند.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000",
                },
              ]
            : []),
        ],
      },
      {
        // عمداً X-Frame-Options ست نشده چون Mini App باید داخل iframe تلگرام (Desktop/Web) باز شود.
        // به‌جاش با CSP فقط به دامنه‌های خود تلگرام اجازه‌ی Embed داده می‌شود؛ بقیه‌ی سایت‌ها مسدودند.
        source: "/:locale/app",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, max-age=0" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org;",
          },
        ],
      },
      {
        source: "/:locale/app/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, max-age=0" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org;",
          },
        ],
      },
      {
        source: "/:locale/admin",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, max-age=0" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org;",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
