"use client";

import { useEffect, useState } from "react";
import { TelegramAuthGate } from "@/components/telegram/auth-gate";
import { WorkingHoursEditor } from "@/components/working-hours-editor";

type TelegramUser = {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  isAdmin: boolean;
};

type Service = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  durationMinutes: number;
  active: boolean;
};

type Business = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  services: Service[];
  _count?: {
    bookings: number;
  };
};

function Dashboard({ user }: { user: TelegramUser }) {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusiness, setSelectedBusiness] =
    useState<Business | null>(null);

  const [loading, setLoading] = useState(true);
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [savingService, setSavingService] = useState(false);

  const [businessName, setBusinessName] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");

  const [serviceName, setServiceName] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [servicePrice, setServicePrice] = useState("");
  const [serviceDuration, setServiceDuration] = useState("60");

  const [message, setMessage] = useState<string | null>(null);

  async function loadBusinesses() {
    try {
      setLoading(true);
      setMessage(null);

      const response = await fetch("/api/business", {
        method: "GET",
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "خطا در دریافت کسب‌وکارها");
      }

      const list: Business[] = data.businesses || [];

      setBusinesses(list);

      if (list.length > 0) {
        setSelectedBusiness((current) => {
          if (!current) {
            return list[0];
          }
          return list.find((item) => item.id === current.id) || list[0];
        });
      } else {
        setSelectedBusiness(null);
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "خطا در دریافت اطلاعات"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBusinesses();
  }, []);

  async function createBusiness(event: React.FormEvent) {
    event.preventDefault();

    if (!businessName.trim()) {
      setMessage("نام کسب‌وکار را وارد کنید.");
      return;
    }

    try {
      setSavingBusiness(true);
      setMessage(null);

      const response = await fetch("/api/business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: businessName.trim(),
          description: businessDescription.trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "ساخت کسب‌وکار ناموفق بود.");
      }

      setBusinessName("");
      setBusinessDescription("");
      await loadBusinesses();
      setMessage("کسب‌وکار با موفقیت ساخته شد.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "خطا در ساخت کسب‌وکار"
      );
    } finally {
      setSavingBusiness(false);
    }
  }

  async function createService(event: React.FormEvent) {
    event.preventDefault();

    if (!selectedBusiness) {
      setMessage("ابتدا یک کسب‌وکار بسازید.");
      return;
    }

    if (!serviceName.trim()) {
      setMessage("نام سرویس را وارد کنید.");
      return;
    }

    const price = Number(servicePrice);
    const durationMinutes = Number(serviceDuration);

    if (!Number.isFinite(price) || price < 0) {
      setMessage("قیمت سرویس معتبر نیست.");
      return;
    }

    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      setMessage("مدت سرویس معتبر نیست.");
      return;
    }

    try {
      setSavingService(true);
      setMessage(null);

      const response = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: selectedBusiness.id,
          name: serviceName.trim(),
          description: serviceDescription.trim() || null,
          price,
          durationMinutes,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "ساخت سرویس ناموفق بود.");
      }

      setServiceName("");
      setServiceDescription("");
      setServicePrice("");
      setServiceDuration("60");

      await loadBusinesses();
      setMessage("سرویس با موفقیت اضافه شد.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "خطا در ساخت سرویس");
    } finally {
      setSavingService(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">
          در حال بارگذاری...
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 py-6">
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <h1 className="text-2xl font-bold">
          سلام {user.firstName || "دوست"} 👋
        </h1>

        <p className="mt-2 text-sm text-muted-foreground">
          مدیریت کسب‌وکار و رزروهای Bookora
        </p>
      </div>

      {message && (
        <div className="rounded-xl border bg-card p-4 text-sm">{message}</div>
      )}

      {businesses.length === 0 ? (
        <form
          onSubmit={createBusiness}
          className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm"
        >
          <div>
            <h2 className="text-xl font-bold">اولین کسب‌وکارت را بساز</h2>

            <p className="mt-1 text-sm text-muted-foreground">
              برای شروع فقط نام کسب‌وکار کافی است.
            </p>
          </div>

          <input
            value={businessName}
            onChange={(event) => setBusinessName(event.target.value)}
            placeholder="مثلاً Mehdi Barber"
            className="w-full rounded-xl border bg-background px-4 py-3 outline-none"
          />

          <textarea
            value={businessDescription}
            onChange={(event) => setBusinessDescription(event.target.value)}
            placeholder="توضیح کوتاه"
            className="min-h-24 w-full rounded-xl border bg-background px-4 py-3 outline-none"
          />

          <button
            type="submit"
            disabled={savingBusiness}
            className="w-full rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground disabled:opacity-50"
          >
            {savingBusiness ? "در حال ساخت..." : "ساخت کسب‌وکار"}
          </button>
        </form>
      ) : (
        <>
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <label className="mb-2 block text-sm font-medium">
              کسب‌وکار
            </label>

            <select
              value={selectedBusiness?.id || ""}
              onChange={(event) => {
                const business = businesses.find(
                  (item) => item.id === event.target.value
                );
                setSelectedBusiness(business || null);
              }}
              className="w-full rounded-xl border bg-background px-4 py-3 outline-none"
            >
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name}
                </option>
              ))}
            </select>
          </div>

          {selectedBusiness && (
            <>
              <div className="rounded-2xl border bg-card p-5 shadow-sm">
                <h2 className="text-xl font-bold">
                  {selectedBusiness.name}
                </h2>

                {selectedBusiness.description && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {selectedBusiness.description}
                  </p>
                )}

                <div className="mt-4 rounded-xl bg-muted p-4">
                  <p className="text-xs text-muted-foreground">
                    لینک رزرو عمومی
                  </p>

                  <a
                    href={`/book/${selectedBusiness.slug}`}
                    className="mt-1 block break-all text-sm font-medium underline"
                  >
                    {typeof window !== "undefined"
                      ? `${window.location.origin}/book/${selectedBusiness.slug}`
                      : `/book/${selectedBusiness.slug}`}
                  </a>
                </div>
              </div>

              <form
                onSubmit={createService}
                className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm"
              >
                <div>
                  <h2 className="text-xl font-bold">افزودن سرویس</h2>

                  <p className="mt-1 text-sm text-muted-foreground">
                    سرویس‌هایی که مشتری می‌تواند رزرو کند.
                  </p>
                </div>

                <input
                  value={serviceName}
                  onChange={(event) => setServiceName(event.target.value)}
                  placeholder="مثلاً Haircut"
                  className="w-full rounded-xl border bg-background px-4 py-3 outline-none"
                />

                <textarea
                  value={serviceDescription}
                  onChange={(event) =>
                    setServiceDescription(event.target.value)
                  }
                  placeholder="توضیح سرویس"
                  className="min-h-20 w-full rounded-xl border bg-background px-4 py-3 outline-none"
                />

                <div className="grid grid-cols-2 gap-3">
                  <input
                    value={servicePrice}
                    onChange={(event) => setServicePrice(event.target.value)}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="قیمت"
                    className="w-full rounded-xl border bg-background px-4 py-3 outline-none"
                  />

                  <input
                    value={serviceDuration}
                    onChange={(event) => setServiceDuration(event.target.value)}
                    type="number"
                    min="1"
                    placeholder="مدت دقیقه"
                    className="w-full rounded-xl border bg-background px-4 py-3 outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingService}
                  className="w-full rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground disabled:opacity-50"
                >
                  {savingService ? "در حال افزودن..." : "افزودن سرویس"}
                </button>
              </form>

              <div className="rounded-2xl border bg-card p-5 shadow-sm">
                <h2 className="text-xl font-bold">سرویس‌ها</h2>

                {selectedBusiness.services.length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">
                    هنوز سرویسی اضافه نشده است.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {selectedBusiness.services.map((service) => (
                      <div key={service.id} className="rounded-xl border p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="font-semibold">{service.name}</h3>

                            {service.description && (
                              <p className="mt-1 text-sm text-muted-foreground">
                                {service.description}
                              </p>
                            )}
                          </div>

                          <div className="text-left text-sm">
                            <div className="font-semibold">
                              {service.price} {service.currency}
                            </div>

                            <div className="text-muted-foreground">
                              {service.durationMinutes} دقیقه
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <WorkingHoursEditor businessId={selectedBusiness.id} />
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function MiniAppPage() {
  return (
    <main className="min-h-screen px-4">
      <TelegramAuthGate>
        {(user) => <Dashboard user={user} />}
      </TelegramAuthGate>
    </main>
  );
}
