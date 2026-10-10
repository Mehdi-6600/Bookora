import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { routing, type Locale } from "@/i18n/routing";
import { env } from "@/lib/env";
import { formatPrice } from "@/lib/currency";

const APP_URL = env.APP_URL.replace(/\/+$/, "");

/**
 * Per-business metadata for the public booking page.
 *
 * The page itself is a client component, so metadata is produced from a server
 * layout that wraps it. This is what makes a shared booking link show the
 * business name, its city and its real service list in Telegram, WhatsApp,
 * Instagram and search results instead of a generic "Bookora" card.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const resolved = routing.locales.includes(locale as Locale)
    ? (locale as Locale)
    : routing.defaultLocale;

  const base = {
    title: "Book a slot | Bookora",
    description: "Book an appointment online.",
  };

  if (!slug || slug.length > 100) return base;

  try {
    const business = await prisma.business.findUnique({
      where: { slug },
      select: {
        name: true,
        description: true,
        city: true,
        currency: true,
        status: true,
        services: {
          where: { active: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { name: true, price: true, currency: true },
          take: 6,
        },
      },
    });

    if (!business || business.status !== "ACTIVE") return base;

    const serviceNames = business.services.map((service) => service.name);

    const cheapest = business.services.reduce<number | null>((lowest, service) => {
      const value = Number(service.price);
      if (!Number.isFinite(value)) return lowest;
      return lowest === null || value < lowest ? value : lowest;
    }, null);

    const pricePart =
      cheapest !== null
        ? ` ${resolved === "fa" ? "از" : "from"} ${formatPrice(
            String(cheapest),
            business.currency || business.services[0]?.currency || "EUR"
          )}.`
        : "";

    const cityPart = business.city ? ` ${business.city}.` : "";

    const description =
      (business.description && business.description.trim().length > 0
        ? business.description.trim().slice(0, 160)
        : `${business.name} — online booking.${cityPart}${pricePart}`) +
      (serviceNames.length > 0 ? ` ${serviceNames.join(", ")}.` : "");

    const title = `${business.name} — ${
      resolved === "fa" ? "رزرو نوبت" : resolved === "ar" ? "حجز موعد" : "book online"
    }`;

    const url =
      resolved === routing.defaultLocale
        ? `${APP_URL}/book/${slug}`
        : `${APP_URL}/${resolved}/book/${slug}`;

    return {
      title,
      description: description.slice(0, 320),
      alternates: { canonical: url },
      openGraph: {
        type: "website",
        siteName: "Bookora",
        title,
        description: description.slice(0, 320),
        url,
        images: [
          { url: "/bookora-og.png", width: 1200, height: 630, alt: business.name },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description: description.slice(0, 320),
        images: ["/bookora-og.png"],
      },
      robots: { index: true, follow: true },
    };
  } catch {
    // Metadata must never break the booking page itself.
    return base;
  }
}

export default function BookingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
