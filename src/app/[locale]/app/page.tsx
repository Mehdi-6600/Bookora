"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { TelegramAuthGate } from "@/components/telegram/auth-gate";
import { WorkingHoursEditor } from "@/components/working-hours-editor";
import { SubscriptionPanel } from "@/components/subscription-panel";
import { TimeOffPanel } from "@/components/time-off-panel";
import { PaymentMethodPanel } from "@/components/payment-method-panel";
import { BookingsPanel } from "@/components/bookings-panel";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link } from "@/i18n/navigation";
import {
  COUNTRY_LABELS,
  CountryCode,
  formatPrice,
  isCountryCode,
} from "@/lib/currency";

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
  depositType: string;
  depositValue: string;
};

type Business = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  country: string | null;
  currency: string;
  status: string;
  services: Service[];
  _count?: {
    bookings: number;
  };
};

const DEPOSIT_LABELS_KEYS = {
  NONE: "depositNone",
  PERCENTAGE: "depositPercentage",
  FIXED: "depositFixed",
} as const;

function Dashboard({ user }: { user: TelegramUser }) {
  const t = useTranslations("dashboard");
  const tWizard = useTranslations("businessWizard");
  const tBiz = useTranslations("business");
  const tSvc = useTranslations("service");
  const tMsg = useTranslations("messages");

  const depositLabels: Record<string, string> = {
    NONE: tSvc(DEPOSIT_LABELS_KEYS.NONE),
    PERCENTAGE: tSvc(DEPOSIT_LABELS_KEYS.PERCENTAGE),
    FIXED: tSvc(DEPOSIT_LABELS_KEYS.FIXED),
  };

  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusiness, setSelectedBusiness] =
    useState<Business | null>(null);

  const [loading, setLoading] = useState(true);
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [savingService, setSavingService] = useState(false);

  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [businessName, setBusinessName] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  const [businessCountry, setBusinessCountry] =
    useState<CountryCode | null>(null);

  const [editingBusiness, setEditingBusiness] = useState(false);
  const [editBusinessName, setEditBusinessName] = useState("");
  const [editBusinessDescription, setEditBusinessDescription] = useState("");
  const [editBusinessCountry, setEditBusinessCountry] =
    useState<CountryCode>("IR");
  const [savingBusinessEdit, setSavingBusinessEdit] = useState(false);
  const [confirmDeleteBusiness, setConfirmDeleteBusiness] = useState(false);
  const [deletingBusiness, setDeletingBusiness] = useState(false);
  const [reactivating, setReactivating] = useState(false);

  const [serviceName, setServiceName] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [servicePrice, setServicePrice] = useState("");
  const [serviceDuration, setServiceDuration] = useState("60");
  const [serviceDepositType, setServiceDepositType] = useState<
    "NONE" | "PERCENTAGE" | "FIXED"
  >("NONE");
  const [serviceDepositValue, setServiceDepositValue] = useState("");

  const [editingServiceId, setEditingServiceId] = useState<string | null>(
    null
  );
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editDuration, setEditDuration] = useState("");
  const [editDepositType, setEditDepositType] = useState<
    "NONE" | "PERCENTAGE" | "FIXED"
  >("NONE");
  const [editDepositValue, setEditDepositValue] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [linkCopied, setLinkCopied] = useState(false);

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
        throw new Error(data?.error || tMsg("loadBusinessesError"));
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
        error instanceof Error ? error.message : tMsg("loadDataError")
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBusinesses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createBusiness(event: React.FormEvent) {
    event.preventDefault();

    if (!businessCountry) {
      setMessage(tMsg("businessCountryRequired"));
      return;
    }

    if (!businessName.trim()) {
      setMessage(tMsg("businessNameRequired"));
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
          country: businessCountry,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || tMsg("businessCreateError"));
      }

      setBusinessName("");
      setBusinessDescription("");
      setBusinessCountry(null);
      setCreateStep(1);
      await loadBusinesses();
      setMessage(tMsg("businessCreated"));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : tMsg("businessCreateError")
      );
    } finally {
      setSavingBusiness(false);
    }
  }

  function startEditBusiness(business: Business) {
    setEditingBusiness(true);
    setEditBusinessName(business.name);
    setEditBusinessDescription(business.description || "");
    setEditBusinessCountry(
      business.country && isCountryCode(business.country)
        ? business.country
        : "IR"
    );
    setConfirmDeleteBusiness(false);
  }

  async function saveBusinessEdit(businessId: string) {
    if (!editBusinessName.trim()) {
      setMessage(tMsg("businessNameRequired"));
      return;
    }

    try {
      setSavingBusinessEdit(true);
      setMessage(null);

      const response = await fetch(`/api/business/${businessId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editBusinessName.trim(),
          description: editBusinessDescription.trim() || null,
          country: editBusinessCountry,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || tMsg("businessEditError"));
      }

      setEditingBusiness(false);
      await loadBusinesses();
      setMessage(
        data.currencyChanged
          ? tMsg("businessEditedCurrency")
          : tMsg("businessEdited")
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : tMsg("businessEditError")
      );
    } finally {
      setSavingBusinessEdit(false);
    }
  }

  async function deleteBusiness(businessId: string) {
    try {
      setDeletingBusiness(true);
      setMessage(null);

      const response = await fetch(`/api/business/${businessId}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || tMsg("businessDeleteError"));
      }

      setConfirmDeleteBusiness(false);
      await loadBusinesses();

      setMessage(
        data.archived ? tMsg("businessArchived") : tMsg("businessDeleted")
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : tMsg("businessDeleteError")
      );
    } finally {
      setDeletingBusiness(false);
    }
  }

  async function reactivateBusiness(business: Business) {
    try {
      setReactivating(true);
      setMessage(null);

      const response = await fetch(`/api/business/${business.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: business.name,
          description: business.description,
          country:
            business.country && isCountryCode(business.country)
              ? business.country
              : "IR",
          reactivate: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || tMsg("businessReactivateError"));
      }

      await loadBusinesses();
      setMessage(tMsg("businessReactivated"));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : tMsg("businessReactivateError")
      );
    } finally {
      setReactivating(false);
    }
  }

  function resetServiceForm() {
    setServiceName("");
    setServiceDescription("");
    setServicePrice("");
    setServiceDuration("60");
    setServiceDepositType("NONE");
    setServiceDepositValue("");
  }

  async function createService(event: React.FormEvent) {
    event.preventDefault();

    if (!selectedBusiness) {
      setMessage(tMsg("businessNeeded"));
      return;
    }

    if (!serviceName.trim()) {
      setMessage(tMsg("serviceNameRequired"));
      return;
    }

    const price = Number(servicePrice);
    const durationMinutes = Number(serviceDuration);
    const depositValue =
      serviceDepositType === "NONE" ? 0 : Number(serviceDepositValue || "0");

    if (!Number.isFinite(price) || price < 0) {
      setMessage(tMsg("servicePriceInvalid"));
      return;
    }

    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      setMessage(tMsg("serviceDurationInvalid"));
      return;
    }

    if (
      serviceDepositType === "PERCENTAGE" &&
      (depositValue < 0 || depositValue > 100)
    ) {
      setMessage(tMsg("serviceDepositPercentInvalid"));
      return;
    }

    if (serviceDepositType === "FIXED" && depositValue < 0) {
      setMessage(tMsg("serviceDepositFixedInvalid"));
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
          depositType: serviceDepositType,
          depositValue,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || tMsg("serviceCreateError"));
      }

      resetServiceForm();
      await loadBusinesses();
      setMessage(tMsg("serviceCreated"));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : tMsg("serviceCreateError")
      );
    } finally {
      setSavingService(false);
    }
  }

  function startEdit(service: Service) {
    setEditingServiceId(service.id);
    setEditName(service.name);
    setEditDescription(service.description || "");
    setEditPrice(service.price);
    setEditDuration(String(service.durationMinutes));
    setEditDepositType(
      (service.depositType as "NONE" | "PERCENTAGE" | "FIXED") || "NONE"
    );
    setEditDepositValue(service.depositValue);
    setConfirmDeleteId(null);
  }

  function cancelEdit() {
    setEditingServiceId(null);
  }

  async function saveEdit(serviceId: string) {
    const price = Number(editPrice);
    const durationMinutes = Number(editDuration);
    const depositValue =
      editDepositType === "NONE" ? 0 : Number(editDepositValue || "0");

    if (!editName.trim()) {
      setMessage(tMsg("serviceNameRequired"));
      return;
    }

    if (!Number.isFinite(price) || price < 0) {
      setMessage(tMsg("servicePriceInvalid"));
      return;
    }

    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      setMessage(tMsg("serviceDurationInvalid"));
      return;
    }

    if (
      editDepositType === "PERCENTAGE" &&
      (depositValue < 0 || depositValue > 100)
    ) {
      setMessage(tMsg("serviceDepositPercentInvalid"));
      return;
    }

    try {
      setSavingEdit(true);
      setMessage(null);

      const response = await fetch(`/api/services/${serviceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
          price,
          durationMinutes,
          depositType: editDepositType,
          depositValue,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || tMsg("serviceEditError"));
      }

      setEditingServiceId(null);
      await loadBusinesses();
      setMessage(tMsg("serviceEdited"));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : tMsg("serviceEditError")
      );
    } finally {
      setSavingEdit(false);
    }
  }

  async function toggleActive(service: Service) {
    try {
      setMessage(null);

      const response = await fetch(`/api/services/${service.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: service.name,
          description: service.description,
          price: Number(service.price),
          durationMinutes: service.durationMinutes,
          active: !service.active,
          depositType: service.depositType,
          depositValue: Number(service.depositValue),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || tMsg("serviceToggleError"));
      }

      await loadBusinesses();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : tMsg("serviceToggleError")
      );
    }
  }

  async function deleteService(serviceId: string) {
    try {
      setDeletingId(serviceId);
      setMessage(null);

      const response = await fetch(`/api/services/${serviceId}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || tMsg("serviceDeleteError"));
      }

      setConfirmDeleteId(null);
      await loadBusinesses();

      setMessage(
        data.deactivated ? tMsg("serviceDeactivated") : tMsg("serviceDeleted")
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : tMsg("serviceDeleteError")
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function copyBookingLink(url: string) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setMessage(tMsg("copyFailed"));
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      </div>
    );
  }

  if (businesses.length > 0 && !selectedBusiness) {
    return (
      <div className="p-8 text-center">
        <p className="text-lg font-bold">{t("loading")}</p>
      </div>
    );
  }

  const isArchived = selectedBusiness?.status === "ARCHIVED";

  const selectedBusinessCountry: CountryCode | null =
    selectedBusiness?.country && isCountryCode(selectedBusiness.country)
      ? selectedBusiness.country
      : null;

  const bookingUrl =
    typeof window !== "undefined" && selectedBusiness
      ? `${window.location.origin}/book/${selectedBusiness.slug}`
      : selectedBusiness
      ? `/book/${selectedBusiness.slug}`
      : "";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 py-6">
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">
              {t("greeting", { name: user.firstName || t("friend") })}
            </h1>

            <p className="mt-2 text-sm text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <LocaleSwitcher />

            {user.isAdmin && (
              <Link
                href="/admin"
                className="rounded-lg border px-3 py-2 text-xs font-medium"
              >
                {t("adminPanel")}
              </Link>
            )}
          </div>
        </div>
      </div>

      <SubscriptionPanel
        businessId={selectedBusiness?.id ?? null}
        country={selectedBusinessCountry}
      />

      {message && (
        <div className="rounded-xl border bg-card p-4 text-sm">{message}</div>
      )}

      {businesses.length === 0 ? (
        <div className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
          {createStep === 1 ? (
            <>
              <div>
                <h2 className="text-xl font-bold">
                  {tWizard("countryQuestion")}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tWizard("countryHelp")}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {(["IR", "OTHER"] as CountryCode[]).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => {
                      setBusinessCountry(code);
                      setCreateStep(2);
                    }}
                    className="rounded-xl border bg-background p-4 text-right"
                  >
                    <div className="font-semibold">
                      {code === "IR"
                        ? tWizard("countryIR")
                        : tWizard("countryOther")}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {code === "IR"
                        ? tWizard("hintIR")
                        : tWizard("hintOther")}
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <form onSubmit={createBusiness} className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">{tWizard("infoTitle")}</h2>
                <button
                  type="button"
                  onClick={() => setCreateStep(1)}
                  className="text-xs text-muted-foreground underline"
                >
                  {tWizard("changeCountry")}
                </button>
              </div>

              <p className="text-sm text-muted-foreground">
                {tWizard("selectedCountry", {
                  country: businessCountry
                    ? businessCountry === "IR"
                      ? tWizard("countryIR")
                      : tWizard("countryOther")
                    : "",
                })}
              </p>

              <input
                value={businessName}
                onChange={(event) => setBusinessName(event.target.value)}
                placeholder={tWizard("namePlaceholder")}
                className="w-full rounded-xl border bg-background px-4 py-3 outline-none"
              />

              <textarea
                value={businessDescription}
                onChange={(event) =>
                  setBusinessDescription(event.target.value)
                }
                placeholder={tWizard("descPlaceholder")}
                className="min-h-24 w-full rounded-xl border bg-background px-4 py-3 outline-none"
              />

              <button
                type="submit"
                disabled={savingBusiness}
                className="w-full rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground disabled:opacity-50"
              >
                {savingBusiness
                  ? tWizard("creating")
                  : tWizard("createButton")}
              </button>
            </form>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <label className="mb-2 block text-sm font-medium">
              {tBiz("selectLabel")}
            </label>

            <select
              value={selectedBusiness?.id || ""}
              onChange={(event) => {
                const business = businesses.find(
                  (item) => item.id === event.target.value
                );
                setSelectedBusiness(business || null);
                setEditingServiceId(null);
                setConfirmDeleteId(null);
                setEditingBusiness(false);
                setConfirmDeleteBusiness(false);
              }}
              className="w-full rounded-xl border bg-background px-4 py-3 outline-none"
            >
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name}
                  {business.status === "ARCHIVED"
                    ? ` ${tBiz("archivedTag")}`
                    : ""}
                </option>
              ))}
            </select>
          </div>

          {selectedBusiness && (
            <>
              <div className="rounded-2xl border bg-card p-5 shadow-sm">
                {isArchived && (
                  <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                    {tBiz("archivedBanner")}
                  </div>
                )}

                {editingBusiness ? (
                  <div className="space-y-3">
                    <input
                      value={editBusinessName}
                      onChange={(event) =>
                        setEditBusinessName(event.target.value)
                      }
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
                    />

                    <textarea
                      value={editBusinessDescription}
                      onChange={(event) =>
                        setEditBusinessDescription(event.target.value)
                      }
                      className="min-h-16 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
                    />

                    <div className="grid grid-cols-2 gap-2">
                      {(["IR", "OTHER"] as CountryCode[]).map((code) => (
                        <button
                          key={code}
                          type="button"
                          onClick={() => setEditBusinessCountry(code)}
                          className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                            editBusinessCountry === code
                              ? "border-primary bg-primary/10"
                              : "bg-background"
                          }`}
                        >
                          {code === "IR"
                            ? tWizard("countryIR")
                            : tWizard("countryOther")}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => saveBusinessEdit(selectedBusiness.id)}
                        disabled={savingBusinessEdit}
                        className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                      >
                        {savingBusinessEdit
                          ? tSvc("saving")
                          : tSvc("saveButton")}
                      </button>

                      <button
                        type="button"
                        onClick={() => setEditingBusiness(false)}
                        className="rounded-lg border px-3 py-2 text-sm font-medium"
                      >
                        {tSvc("cancelButton")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h2 className="text-xl font-bold">
                      {selectedBusiness.name}
                    </h2>

                    {selectedBusiness.description && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {selectedBusiness.description}
                      </p>
                    )}

                    <p className="mt-2 text-xs text-muted-foreground">
                      {tBiz("countryLabel")}:{" "}
                      {selectedBusinessCountry
                        ? selectedBusinessCountry === "IR"
                          ? tWizard("countryIR")
                          : tWizard("countryOther")
                        : tBiz("notSet")}{" "}
                      — {tBiz("currencyLabel")}: {selectedBusiness.currency}
                    </p>

                    <div className="mt-4 rounded-xl bg-muted p-4">
                      <p className="text-xs text-muted-foreground">
                        {tBiz("bookingLinkLabel")}
                      </p>

                      <p className="mt-1 break-all text-sm font-medium">
                        {bookingUrl}
                      </p>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => copyBookingLink(bookingUrl)}
                          className="rounded-lg border px-3 py-2 text-xs font-medium"
                        >
                          {linkCopied ? tBiz("copied") : tBiz("copyLink")}
                        </button>

                        <a
                          href={`/book/${selectedBusiness.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border px-3 py-2 text-center text-xs font-medium"
                        >
                          {tBiz("openPage")}
                        </a>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      {isArchived ? (
                        <button
                          type="button"
                          onClick={() => reactivateBusiness(selectedBusiness)}
                          disabled={reactivating}
                          className="col-span-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                        >
                          {reactivating
                            ? tBiz("reactivating")
                            : tBiz("reactivateButton")}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => startEditBusiness(selectedBusiness)}
                            className="rounded-lg border px-3 py-2 text-sm font-medium"
                          >
                            {tBiz("editButton")}
                          </button>

                          {confirmDeleteBusiness ? (
                            <button
                              type="button"
                              onClick={() =>
                                deleteBusiness(selectedBusiness.id)
                              }
                              disabled={deletingBusiness}
                              className="rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
                            >
                              {deletingBusiness
                                ? tBiz("deleting")
                                : tBiz("confirmDelete")}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteBusiness(true)}
                              className="rounded-lg border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive"
                            >
                              {tBiz("deleteButton")}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>

              {!isArchived && (
                <>
                  <form
                    onSubmit={createService}
                    className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm"
                  >
                    <div>
                      <h2 className="text-xl font-bold">
                        {tSvc("addTitle")}
                      </h2>

                      <p className="mt-1 text-sm text-muted-foreground">
                        {tSvc("addDesc")}
                      </p>
                    </div>

                    <input
                      value={serviceName}
                      onChange={(event) => setServiceName(event.target.value)}
                      placeholder={tSvc("namePlaceholder")}
                      className="w-full rounded-xl border bg-background px-4 py-3 outline-none"
                    />

                    <textarea
                      value={serviceDescription}
                      onChange={(event) =>
                        setServiceDescription(event.target.value)
                      }
                      placeholder={tSvc("descPlaceholder")}
                      className="min-h-20 w-full rounded-xl border bg-background px-4 py-3 outline-none"
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
                        placeholder={tSvc("pricePlaceholder", {
                          currency: selectedBusiness.currency,
                        })}
                        className="w-full rounded-xl border bg-background px-4 py-3 outline-none"
                      />

                      <input
                        value={serviceDuration}
                        onChange={(event) =>
                          setServiceDuration(event.target.value)
                        }
                        type="number"
                        min="1"
                        placeholder={tSvc("durationPlaceholder")}
                        className="w-full rounded-xl border bg-background px-4 py-3 outline-none"
                      />
                    </div>

                    <div>
                      <p className="mb-2 text-sm font-medium">
                        {tSvc("depositLabel")}
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {(["NONE", "PERCENTAGE", "FIXED"] as const).map(
                          (type) => (
                            <button
                              key={type}
                              type="button"
                              onClick={() => setServiceDepositType(type)}
                              className={`rounded-lg border px-2 py-2 text-xs font-medium ${
                                serviceDepositType === type
                                  ? "border-primary bg-primary/10"
                                  : "bg-background"
                              }`}
                            >
                              {depositLabels[type]}
                            </button>
                          )
                        )}
                      </div>

                      {serviceDepositType !== "NONE" && (
                        <input
                          value={serviceDepositValue}
                          onChange={(event) =>
                            setServiceDepositValue(event.target.value)
                          }
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder={
                            serviceDepositType === "PERCENTAGE"
                              ? tSvc("depositPercentPlaceholder")
                              : tSvc("depositFixedPlaceholder", {
                                  currency: selectedBusiness.currency,
                                })
                          }
                          className="mt-2 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
                        />
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={savingService}
                      className="w-full rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {savingService ? tSvc("adding") : tSvc("addButton")}
                    </button>
                  </form>

                  <div className="rounded-2xl border bg-card p-5 shadow-sm">
                    <h2 className="text-xl font-bold">{tSvc("listTitle")}</h2>

                    {selectedBusiness.services.length === 0 ? (
                      <p className="mt-4 text-sm text-muted-foreground">
                        {tSvc("empty")}
                      </p>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {selectedBusiness.services.map((service) => (
                          <div
                            key={service.id}
                            className="rounded-xl border p-4"
                          >
                            {editingServiceId === service.id ? (
                              <div className="space-y-3">
                                <input
                                  value={editName}
                                  onChange={(event) =>
                                    setEditName(event.target.value)
                                  }
                                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
                                />

                                <textarea
                                  value={editDescription}
                                  onChange={(event) =>
                                    setEditDescription(event.target.value)
                                  }
                                  className="min-h-16 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
                                />

                                <div className="grid grid-cols-2 gap-2">
                                  <input
                                    value={editPrice}
                                    onChange={(event) =>
                                      setEditPrice(event.target.value)
                                    }
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
                                  />

                                  <input
                                    value={editDuration}
                                    onChange={(event) =>
                                      setEditDuration(event.target.value)
                                    }
                                    type="number"
                                    min="1"
                                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
                                  />
                                </div>

                                <div>
                                  <div className="grid grid-cols-3 gap-2">
                                    {(
                                      ["NONE", "PERCENTAGE", "FIXED"] as const
                                    ).map((type) => (
                                      <button
                                        key={type}
                                        type="button"
                                        onClick={() =>
                                          setEditDepositType(type)
                                        }
                                        className={`rounded-lg border px-2 py-2 text-xs font-medium ${
                                          editDepositType === type
                                            ? "border-primary bg-primary/10"
                                            : "bg-background"
                                        }`}
                                      >
                                        {depositLabels[type]}
                                      </button>
                                    ))}
                                  </div>

                                  {editDepositType !== "NONE" && (
                                    <input
                                      value={editDepositValue}
                                      onChange={(event) =>
                                        setEditDepositValue(event.target.value)
                                      }
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      className="mt-2 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
                                    />
                                  )}
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  <button
                                    type="button"
                                    onClick={() => saveEdit(service.id)}
                                    disabled={savingEdit}
                                    className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                                  >
                                    {savingEdit
                                      ? tSvc("saving")
                                      : tSvc("saveButton")}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={cancelEdit}
                                    className="rounded-lg border px-3 py-2 text-sm font-medium"
                                  >
                                    {tSvc("cancelButton")}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-start justify-between gap-4">
                                  <div>
                                    <h3 className="font-semibold">
                                      {service.name}
                                      {!service.active && (
                                        <span className="mr-2 text-xs font-normal text-muted-foreground">
                                          {tSvc("inactiveTag")}
                                        </span>
                                      )}
                                    </h3>

                                    {service.description && (
                                      <p className="mt-1 text-sm text-muted-foreground">
                                        {service.description}
                                      </p>
                                    )}

                                    {service.depositType !== "NONE" && (
                                      <p className="mt-1 text-xs text-primary">
                                        {tSvc("depositInfo", {
                                          type: depositLabels[
                                            service.depositType
                                          ],
                                          value:
                                            service.depositType ===
                                            "PERCENTAGE"
                                              ? `${service.depositValue}%`
                                              : formatPrice(
                                                  service.depositValue,
                                                  service.currency
                                                ),
                                        })}
                                      </p>
                                    )}
                                  </div>

                                  <div className="text-left text-sm">
                                    <div className="font-semibold">
                                      {formatPrice(
                                        service.price,
                                        service.currency
                                      )}
                                    </div>

                                    <div className="text-muted-foreground">
                                      {tSvc("minutes", {
                                        count: service.durationMinutes,
                                      })}
                                    </div>
                                  </div>
                                </div>

                                <div className="mt-3 grid grid-cols-3 gap-2">
                                  <button
                                    type="button"
                                    onClick={() => startEdit(service)}
                                    className="rounded-lg border px-3 py-2 text-xs font-medium"
                                  >
                                    {tSvc("editButton")}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => toggleActive(service)}
                                    className="rounded-lg border px-3 py-2 text-xs font-medium"
                                  >
                                    {service.active
                                      ? tSvc("deactivate")
                                      : tSvc("activate")}
                                  </button>

                                  {confirmDeleteId === service.id ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        deleteService(service.id)
                                      }
                                      disabled={deletingId === service.id}
                                      className="rounded-lg bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground disabled:opacity-50"
                                    >
                                      {deletingId === service.id
                                        ? "..."
                                        : tSvc("confirmDelete")}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConfirmDeleteId(service.id)
                                      }
                                      className="rounded-lg border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive"
                                    >
                                      {tSvc("deleteButton")}
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <BookingsPanel businessId={selectedBusiness.id} />

                  <PaymentMethodPanel businessId={selectedBusiness.id} />

                  <WorkingHoursEditor businessId={selectedBusiness.id} />

                  <TimeOffPanel businessId={selectedBusiness.id} />
                </>
              )}
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
