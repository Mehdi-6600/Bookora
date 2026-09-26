import { notFound } from "next/navigation";
import { findBusinessBySlug } from "@/lib/booking/slug";

type Params = Promise<{ locale: string; slug: string }>;

export default async function PublicBookingPage({
  params,
}: {
  params: Params;
}) {
  const { slug } = await params;
  const business = await findBusinessBySlug(slug);

  if (!business) {
    notFound();
  }

  if (business.status !== "ACTIVE") {
    return (
      <main className="min-h-screen bg-background px-4 py-12">
        <div className="mx-auto max-w-md rounded-2xl border bg-card p-6 text-center">
          <h1 className="text-xl font-bold">این کسب‌وکار غیرفعال است</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="rounded-2xl border bg-card p-6 shadow-sm">
          <h1 className="text-2xl font-bold">{business.name}</h1>

          {business.description && (
            <p className="mt-2 text-sm text-muted-foreground">
              {business.description}
            </p>
          )}

          {(business.city || business.country) && (
            <p className="mt-3 text-xs text-muted-foreground">
              {[business.city, business.country].filter(Boolean).join("، ")}
            </p>
          )}

          {business.phone && (
            <p className="mt-1 text-xs text-muted-foreground">
              {business.phone}
            </p>
          )}
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">سرویس‌ها</h2>

          {business.services.length === 0 ? (
            <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
              هنوز سرویسی اضافه نشده است.
            </div>
          ) : (
            <ul className="space-y-3">
              {business.services.map((service) => (
                <li
                  key={service.id}
                  className="rounded-2xl border bg-card p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold">
                        {service.name}
                      </h3>

                      {service.description && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {service.description}
                        </p>
                      )}

                      <p className="mt-2 text-xs text-muted-foreground">
                        {service.durationMinutes} دقیقه
                      </p>
                    </div>

                    <div className="shrink-0 text-left">
                      <div className="font-semibold">
                        {service.price.toString()} {service.currency}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-center text-xs text-muted-foreground">
          در حال ساخت صفحه رزرو...
        </p>
      </div>
    </main>
  );
}
