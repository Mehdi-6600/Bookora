"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, Scissors, X } from "lucide-react";

type Service = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  durationMinutes: number;
  slotIntervalMinutes: number;
  active: boolean;
  depositType: string;
  depositValue: string;
};

type Props = {
  businessId: string;
  services: Service[];
  onChanged: () => Promise<void> | void;
};

export function ServiceManager({
  businessId,
  services,
  onChanged,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const [serviceName, setServiceName] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [servicePrice, setServicePrice] = useState("");
  const [serviceDuration, setServiceDuration] = useState("60");
  const [serviceSlotInterval, setServiceSlotInterval] = useState("30");

  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setServiceName("");
    setServiceDescription("");
    setServicePrice("");
    setServiceDuration("60");
    setServiceSlotInterval("30");
    setError(null);
  }

  function closeForm() {
    if (saving) return;

    resetForm();
    setAdding(false);
  }

  async function createService() {
    setError(null);

    if (!serviceName.trim()) {
      setError("نام خدمت را وارد کنید.");
      return;
    }

    const price = Number(servicePrice);
    const durationMinutes = Number(serviceDuration);
    const slotIntervalMinutes = Number(serviceSlotInterval);

    if (!Number.isFinite(price) || price < 0) {
      setError("قیمت خدمت معتبر نیست.");
      return;
    }

    if (
      !Number.isInteger(durationMinutes) ||
      durationMinutes <= 0
    ) {
      setError("مدت خدمت معتبر نیست.");
      return;
    }

    if (
      !Number.isInteger(slotIntervalMinutes) ||
      slotIntervalMinutes < 5
    ) {
      setError("فاصله زمانی نوبت معتبر نیست.");
      return;
    }

    try {
      setSaving(true);

      const response = await fetch("/api/services", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          businessId,
          name: serviceName.trim(),
          description:
            serviceDescription.trim() || null,
          price,
          durationMinutes,
          slotIntervalMinutes,
          depositType: "NONE",
          depositValue: 0,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error || "ثبت خدمت ناموفق بود."
        );
      }

      resetForm();
      setAdding(false);

      await onChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "ثبت خدمت ناموفق بود."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-3xl border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
          <Scissors className="h-5 w-5 text-primary" />
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold">
            خدمات
          </h2>

          <p className="mt-1 text-sm text-muted-foreground">
            خدماتی که مشتری هنگام رزرو می‌تواند انتخاب کند.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {services.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-5 text-center">
            <p className="text-sm text-muted-foreground">
              هنوز خدمتی ثبت نشده است.
            </p>
          </div>
        ) : (
          services.map((service, index) => (
            <div
              key={service.id}
              className="rounded-2xl border bg-background p-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                  {index + 1}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold">
                        {service.name}
                      </h3>

                      {service.description && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {service.description}
                        </p>
                      )}
                    </div>

                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                        service.active
                          ? "bg-green-500/10 text-green-600"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {service.active
                        ? "فعال"
                        : "غیرفعال"}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="rounded-lg bg-muted px-2.5 py-1.5">
                      {service.price}{" "}
                      {service.currency}
                    </span>

                    <span className="rounded-lg bg-muted px-2.5 py-1.5">
                      {service.durationMinutes} دقیقه
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {!adding ? (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setAdding(true);
          }}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-4 text-sm font-bold transition-colors hover:bg-muted active:scale-[0.99]"
        >
          <Plus className="h-5 w-5" />
          افزودن خدمات
        </button>
      ) : (
        <div className="mt-4 rounded-2xl border bg-background p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold">
                خدمت جدید
              </h3>

              <p className="mt-1 text-xs text-muted-foreground">
                اطلاعات این خدمت را وارد کنید.
              </p>
            </div>

            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="rounded-xl p-2 text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <input
              value={serviceName}
              onChange={(event) =>
                setServiceName(event.target.value)
              }
              placeholder="نام خدمت؛ مثلاً کوتاهی مو"
              className="w-full rounded-xl border bg-card px-4 py-3 outline-none"
            />

            <textarea
              value={serviceDescription}
              onChange={(event) =>
                setServiceDescription(
                  event.target.value
                )
              }
              placeholder="توضیح کوتاه خدمت"
              className="min-h-20 w-full rounded-xl border bg-card px-4 py-3 outline-none"
            />

            <div className="grid grid-cols-2 gap-3">
              <input
                value={servicePrice}
                onChange={(event) =>
                  setServicePrice(event.target.value)
                }
                type="number"
                min="0"
                step="0.01"
                placeholder="قیمت"
                className="w-full rounded-xl border bg-card px-4 py-3 outline-none"
              />

              <input
                value={serviceDuration}
                onChange={(event) =>
                  setServiceDuration(
                    event.target.value
                  )
                }
                type="number"
                min="1"
                placeholder="مدت دقیقه"
                className="w-full rounded-xl border bg-card px-4 py-3 outline-none"
              />
            </div>

            <input
              value={serviceSlotInterval}
              onChange={(event) =>
                setServiceSlotInterval(
                  event.target.value
                )
              }
              type="number"
              min="5"
              placeholder="فاصله نوبت‌ها به دقیقه"
              className="w-full rounded-xl border bg-card px-4 py-3 outline-none"
            />

            {error && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={createService}
              disabled={saving}
              className="w-full rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving
                ? "در حال ثبت..."
                : "ثبت خدمت"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
