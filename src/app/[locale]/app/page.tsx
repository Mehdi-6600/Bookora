"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Plus,
  Power,
  Scissors,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { TelegramAuthGate } from "@/components/telegram/auth-gate";
import { WorkingHoursEditor } from "@/components/working-hours-editor";
import { SubscriptionPanel } from "@/components/subscription-panel";
import { TimeOffPanel } from "@/components/time-off-panel";
import { PaymentMethodPanel } from "@/components/payment-method-panel";
import { BookingsPanel } from "@/components/bookings-panel";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link } from "@/i18n/navigation";
import {
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
  slotIntervalMinutes: number;
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
  timezone: string;
  status: string;
  services: Service[];
  _count?: {
    bookings: number;
  };
};

const CARD_MAIN = "rounded-3xl bg-[#B8D4F5] p-5 shadow-soft";
const CARD_INNER = "rounded-2xl bg-white p-4 shadow-soft";
const BTN_PRIMARY =
  "btn-elevated flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4F5FE8] px-4 py-3.5 text-sm font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-50";
const BTN_GHOST =
  "flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-[#1A1F36] shadow-soft transition-transform active:scale-[0.98] disabled:opacity-50";
const BTN_ADD_SERVICE =
  "btn-elevated flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4F5FE8] px-4 py-3.5 text-sm font-bold text-white transition-transform active:scale-[0.98]";
const INPUT_BASE =
  "w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-[#1A1F36] outline-none placeholder:text-[#1A1F36]/40 shadow-soft";
const SECTION_ICON =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft";
const SECTION_TITLE = "text-base font-bold text-[#1A1F36]";
const LABEL_SMALL =
  "mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[#1A1F36]/60";

function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

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
  const tAdmin = useTranslations("admin");

  const searchParams = useSearchParams();
  const queryBusinessId = searchParams.get("businessId");
  const adminView = user.isAdmin && !!queryBusinessId;

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
  const [showServiceForm, setShowServiceForm] = useState(false);

  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [businessName, setBusinessName] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  const [businessCountry, setBusinessCountry] =
    useState<CountryCode | null>(null);
  const [businessTimezone, setBusinessTimezone] = useState("Asia/Tehran");

  const [editingBusiness, setEditingBusiness] = useState(false);
  const [editBusinessName, setEditBusinessName] = useState("");
  const [editBusinessDescription, setEditBusinessDescription] = useState("");
  const [editBusinessCountry, setEditBusinessCountry] =
    useState<CountryCode>("IR");
  const [editBusinessTimezone, setEditBusinessTimezone] =
    useState("Asia/Tehran");
  const [savingBusinessEdit, setSavingBusinessEdit] = useState(false);
  const [confirmDeleteBusiness, setConfirmDeleteBusiness] = useState(false);
  const [deletingBusiness, setDeletingBusiness] = useState(false);
  const [reactivating, setReactivating] = useState(false);

  const [serviceName, setServiceName] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [servicePrice, setServicePrice] = useState("");
  const [serviceDuration, setServiceDuration] = useState("60");
  const [serviceSlotInterval, setServiceSlotInterval] = useState("30");
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
  const [editSlotInterval, setEditSlotInterval] = useState("30");
  const [editDepositType, setEditDepositType] = useState<
    "NONE" | "PERCENTAGE" | "FIXED"
  >("NONE");
  const [editDepositValue, setEditDepositValue] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [linkCopied, setLinkCopied] = useState(false);

  const [message, setMessage] = useState<string | null>(null);

  async function loadAdminBusinesses() {
    try {
      setLoading(true);
      setMessage(null);

      const listResp = await fetch("/api/admin/businesses", {
        cache: "no-store",
      });

      const listData = await listResp.json();

      if (!listResp.ok) {
        throw new Error(listData?.error || tMsg("loadBusinessesError"));
      }

      type AdminBizRow = {
        id: string;
        name: string;
        slug: string;
        country: string | null;
        currency: string;
        timezone: string;
        status: string;
        counts: { services: number; bookings: number };
      };

      const adminList: AdminBizRow[] = listData.businesses || [];

      const list: Business[] = adminList.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: null,
        country: row.country,
        currency: row.currency,
        timezone: row.timezone,
        status: row.status,
        services: [],
        _count: { bookings: row.counts.bookings },
      }));

      setBusinesses(list);

      const target =
        list.find((b) => b.id === queryBusinessId) || list[0] || null;

      if (!target) {
        setSelectedBusiness(null);
        return;
      }

      const detailResp = await fetch(
        "/api/admin/businesses/" + target.id,
        { cache: "no-store" }
      );

      const detailData = await detailResp.json();

      if (!detailResp.ok) {
        throw new Error(detailData?.error || tMsg("loadDataError"));
      }

      const full: Business = detailData.business;

      setBusinesses((current) =>
        current.map((b) => (b.id === full.id ? full : b))
      );

      setSelectedBusiness(full);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : tMsg("loadDataError")
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadBusinesses(options?: { silent?: boolean }) {
    const silent = options?.silent === true;

    if (adminView) {
      await loadAdminBusinesses();
      return;
    }

    try {
      if (!silent) setLoading(true);
      if (!silent) setMessage(null);

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
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadBusinesses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createBusiness(event: FormEvent) {
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
          timezone: businessTimezone,
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
      await loadBusinesses({ silent: true });
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
    setEditBusinessTimezone(business.timezone || "UTC");
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

      const response = await fetch("/api/business/" + businessId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editBusinessName.trim(),
          description: editBusinessDescription.trim() || null,
          country: editBusinessCountry,
          timezone: editBusinessTimezone,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || tMsg("businessEditError"));
      }

      setEditingBusiness(false);
      await loadBusinesses({ silent: true });
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

      const response = await fetch("/api/business/" + businessId, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || tMsg("businessDeleteError"));
      }

      setConfirmDeleteBusiness(false);
      await loadBusinesses({ silent: true });

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

      const response = await fetch("/api/business/" + business.id, {
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

      await loadBusinesses({ silent: true });
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
    setServiceSlotInterval("30");
    setServiceDepositType("NONE");
    setServiceDepositValue("");
  }

  async function createService(event: FormEvent) {
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
    const slotIntervalMinutes = Number(serviceSlotInterval);
    const depositValue =
      serviceDepositType === "NONE"
        ? 0
        : Number(serviceDepositValue || "0");

    if (!Number.isFinite(price) || price < 0) {
      setMessage(tMsg("servicePriceInvalid"));
      return;
    }

    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      setMessage(tMsg("serviceDurationInvalid"));
      return;
    }

    if (
      !Number.isInteger(slotIntervalMinutes) ||
      slotIntervalMinutes < 5
    ) {
      setMessage(tMsg("serviceSlotIntervalInvalid"));
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
          price: price,
          durationMinutes: durationMinutes,
          slotIntervalMinutes: slotIntervalMinutes,
          depositType: serviceDepositType,
          depositValue: depositValue,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || tMsg("serviceCreateError"));
      }

      resetServiceForm();
      setShowServiceForm(false);

      await loadBusinesses({ silent: true });

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
    setEditSlotInterval(String(service.slotIntervalMinutes || 30));
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
    const slotIntervalMinutes = Number(editSlotInterval);
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
      !adminView &&
      (!Number.isInteger(slotIntervalMinutes) ||
        slotIntervalMinutes < 5)
    ) {
      setMessage(tMsg("serviceSlotIntervalInvalid"));
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

      const payload = adminView
        ? {
            price: price,
            name: editName.trim(),
            durationMinutes: durationMinutes,
            description: editDescription.trim() || null,
          }
        : {
            name: editName.trim(),
            description: editDescription.trim() || null,
            price: price,
            durationMinutes: durationMinutes,
            slotIntervalMinutes: slotIntervalMinutes,
            depositType: editDepositType,
            depositValue: depositValue,
          };

      const response = await fetch("/api/services/" + serviceId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || tMsg("serviceEditError"));
      }

      setEditingServiceId(null);

      await loadBusinesses({ silent: true });

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

      const response = await fetch("/api/services/" + service.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: service.name,
          description: service.description,
          price: Number(service.price),
          durationMinutes: service.durationMinutes,
          slotIntervalMinutes: service.slotIntervalMinutes,
          active: !service.active,
          depositType: service.depositType,
          depositValue: Number(service.depositValue),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || tMsg("serviceToggleError"));
      }

      await loadBusinesses({ silent: true });
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

      const response = await fetch("/api/services/" + serviceId, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || tMsg("serviceDeleteError"));
      }

      setConfirmDeleteId(null);

      await loadBusinesses({ silent: true });

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
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("loading")}
        </div>
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
      ? window.location.origin + "/book/" + selectedBusiness.slug
      : selectedBusiness
      ? "/book/" + selectedBusiness.slug
      : "";

  const activeServices = selectedBusiness
    ? selectedBusiness.services.filter((s) => s.active).length
    : 0;

  const hasServices =
    selectedBusiness && selectedBusiness.services.length > 0;

  const adminBannerText = tAdmin("adminViewBanner");
  const adminBackText = tAdmin("backToAdmin");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      {adminView && (
        <div className="flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 shadow-soft">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-primary">
              {adminBannerText}
            </p>
            {selectedBusiness && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {selectedBusiness.name}
              </p>
            )}
          </div>
          <a
            href="/admin"
            className="ring-focus shrink-0 rounded-lg border border-border/60 bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft className="me-1 inline h-3 w-3" />
            {adminBackText}
          </a>
        </div>
      )}

      <header className={CARD_MAIN}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight text-[#1A1F36] sm:text-2xl">
              {t("greeting", { name: user.firstName || t("friend") })}
            </h1>
            <p className="mt-1.5 text-sm font-medium text-[#1A1F36]/60">
              {t("subtitle")}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <LocaleSwitcher />

            {user.isAdmin && !adminView && (
              <Link
                href="/admin"
                className="ring-focus rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
              >
                {t("adminPanel")}
              </Link>
            )}
          </div>
        </div>
      </header>

      {!adminView && (
        <SubscriptionPanel
          businessId={selectedBusiness?.id ?? null}
          country={selectedBusinessCountry}
        />
      )}

      {message && (
        <div className="rounded-2xl bg-white p-3.5 text-sm font-medium text-[#1A1F36] shadow-soft">
          {message}
        </div>
      )}

      {businesses.length === 0 && !adminView ? (
        <section className={CARD_MAIN}>
          {createStep === 1 ? (
            <>
              <div className="flex items-start gap-3">
                <span className={SECTION_ICON}>
                  <Building2 className="h-5 w-5 text-[#4F5FE8]" />
                </span>
                <div>
                  <h2 className={SECTION_TITLE}>
                    {tWizard("countryQuestion")}
                  </h2>
                  <p className="mt-0.5 text-xs font-medium text-[#1A1F36]/60">
                    {tWizard("countryHelp")}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3">
                {(["IR", "OTHER"] as CountryCode[]).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => {
                      setBusinessCountry(code);
                      setBusinessTimezone(
                        code === "IR" ? "Asia/Tehran" : getBrowserTimeZone()
                      );
                      setCreateStep(2);
                    }}
                    className="ring-focus rounded-2xl bg-white p-4 text-start shadow-soft transition-colors hover:bg-white/90"
                  >
                    <div className="font-bold text-[#1A1F36]">
                      {code === "IR"
                        ? tWizard("countryIR")
                        : tWizard("countryOther")}
                    </div>
                    <div className="mt-1 text-xs font-medium text-[#1A1F36]/60">
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
              <div className="flex items-center justify-between gap-3">
                <h2 className={SECTION_TITLE}>{tWizard("infoTitle")}</h2>
                <button
                  type="button"
                  onClick={() => setCreateStep(1)}
                  className="ring-focus rounded-md px-2 py-1 text-xs font-medium text-[#1A1F36]/60 underline-offset-4 hover:underline"
                >
                  {tWizard("changeCountry")}
                </button>
              </div>

              <p className="text-sm font-medium text-[#1A1F36]/70">
                {tWizard("selectedCountry", {
                  country: businessCountry
                    ? businessCountry === "IR"
                      ? tWizard("countryIR")
                      : tWizard("countryOther")
                    : "",
                })}
              </p>

              <div>
                <label className={LABEL_SMALL}>
                  {tWizard("timezoneLabel")}
                </label>
                <input
                  value={businessTimezone}
                  onChange={(event) => setBusinessTimezone(event.target.value)}
                  list="business-timezones-create"
                  placeholder={tWizard("timezonePlaceholder")}
                  autoComplete="off"
                  className={INPUT_BASE}
                />
                <p className="mt-1.5 text-xs font-medium text-[#1A1F36]/60">
                  {tWizard("timezoneHelp")}
                </p>
                <datalist id="business-timezones-create">
                  {[
                    "UTC",
                    "Asia/Tehran",
                    "Asia/Dubai",
                    "Asia/Tokyo",
                    "Europe/London",
                    "Europe/Berlin",
                    "America/New_York",
                    "America/Los_Angeles",
                    "Australia/Sydney",
                  ].map((timezone) => (
                    <option key={timezone} value={timezone} />
                  ))}
                </datalist>
              </div>

              <input
                value={businessName}
                onChange={(event) => setBusinessName(event.target.value)}
                placeholder={tWizard("namePlaceholder")}
                className={INPUT_BASE}
              />

              <textarea
                value={businessDescription}
                onChange={(event) =>
                  setBusinessDescription(event.target.value)
                }
                placeholder={tWizard("descPlaceholder")}
                className={INPUT_BASE + " min-h-24"}
              />

              <button
                type="submit"
                disabled={savingBusiness}
                className={BTN_PRIMARY}
              >
                {savingBusiness && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {savingBusiness
                  ? tWizard("creating")
                  : tWizard("createButton")}
              </button>
            </form>
          )}
        </section>
      ) : (
        <>
          <div className={CARD_INNER}>
            <label className={LABEL_SMALL}>{tBiz("selectLabel")}</label>

            <div className="relative">
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
                  setShowServiceForm(false);
                }}
                className="ring-focus w-full appearance-none rounded-2xl bg-white px-4 py-3 pe-10 text-sm font-bold text-[#1A1F36] outline-none shadow-soft"
              >
                {businesses.map((business) => (
                  <option key={business.id} value={business.id}>
                    {business.name}
                    {business.status === "ARCHIVED"
                      ? " " + tBiz("archivedTag")
                      : ""}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute inset-y-0 end-3 my-auto h-4 w-4 text-[#1A1F36]/40" />
            </div>
          </div>

          {selectedBusiness && (
            <>
              <section className="overflow-hidden rounded-3xl bg-[#B8D4F5] shadow-soft">
                <div className="bg-white/40 p-5">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft">
                      <Building2 className="h-5 w-5 text-[#4F5FE8]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-lg font-bold tracking-tight text-[#1A1F36]">
                          {selectedBusiness.name}
                        </h2>
                        {isArchived && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#FCA311] px-2.5 py-1 text-[10px] font-bold text-white shadow-soft">
                            <ShieldAlert className="h-3 w-3" />
                            {tBiz("archivedTag")}
                          </span>
                        )}
                      </div>

                      {selectedBusiness.description && (
                        <p className="mt-1 line-clamp-2 text-xs font-medium text-[#1A1F36]/70">
                          {selectedBusiness.description}
                        </p>
                      )}

                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-[#1A1F36]/70">
                        <span>
                          {tBiz("countryLabel")}
                          {": "}
                          <span className="font-bold text-[#1A1F36]">
                            {selectedBusinessCountry
                              ? selectedBusinessCountry === "IR"
                                ? tWizard("countryIR")
                                : tWizard("countryOther")
                              : tBiz("notSet")}
                          </span>
                        </span>
                        <span className="opacity-50">•</span>
                        <span>
                          {tBiz("currencyLabel")}
                          {": "}
                          <span className="font-bold text-[#1A1F36]">
                            {selectedBusiness.currency}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className={CARD_INNER}>
                      <div className="flex items-center gap-2 text-[#1A1F36]/60">
                        <Scissors className="h-3.5 w-3.5" />
                        <span className="text-[11px] font-bold uppercase tracking-wide">
                          {tSvc("listTitle")}
                        </span>
                      </div>
                      <div className="tabular mt-1.5 text-xl font-bold text-[#1A1F36]">
                        {selectedBusiness.services.length}
                      </div>
                    </div>
                    <div className={CARD_INNER}>
                      <div className="flex items-center gap-2 text-[#1A1F36]/60">
                        <Users className="h-3.5 w-3.5" />
                        <span className="text-[11px] font-bold uppercase tracking-wide">
                          {tSvc("listTitle")}
                        </span>
                      </div>
                      <div className="tabular mt-1.5 text-xl font-bold text-[#1A1F36]">
                        {selectedBusiness._count?.bookings ?? 0}
                      </div>
                    </div>
                  </div>
                </div>

                {isArchived && (
                  <div className="flex items-start gap-2 bg-[#FCA311]/15 p-4 text-sm font-medium text-[#1A1F36]/80">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#FCA311]" />
                    <span>{tBiz("archivedBanner")}</span>
                  </div>
                )}

                <div className="p-5">
                  {editingBusiness && !adminView ? (
                    <div className="space-y-3">
                      <input
                        value={editBusinessName}
                        onChange={(event) =>
                          setEditBusinessName(event.target.value)
                        }
                        className={INPUT_BASE}
                      />

                      <textarea
                        value={editBusinessDescription}
                        onChange={(event) =>
                          setEditBusinessDescription(event.target.value)
                        }
                        className={INPUT_BASE + " min-h-16"}
                      />

                      <div>
                        <label className={LABEL_SMALL}>
                          {tWizard("timezoneLabel")}
                        </label>
                        <input
                          value={editBusinessTimezone}
                          onChange={(event) =>
                            setEditBusinessTimezone(event.target.value)
                          }
                          list="business-timezones-edit"
                          placeholder={tWizard("timezonePlaceholder")}
                          autoComplete="off"
                          className={INPUT_BASE}
                        />
                        <datalist id="business-timezones-edit">
                          {[
                            "UTC",
                            "Asia/Tehran",
                            "Asia/Dubai",
                            "Asia/Tokyo",
                            "Europe/London",
                            "Europe/Berlin",
                            "America/New_York",
                            "America/Los_Angeles",
                            "Australia/Sydney",
                          ].map((timezone) => (
                            <option key={timezone} value={timezone} />
                          ))}
                        </datalist>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {(["IR", "OTHER"] as CountryCode[]).map((code) => (
                          <button
                            key={code}
                            type="button"
                            onClick={() => {
                              if (editBusinessCountry !== code) {
                                setEditBusinessCountry(code);
                                setEditBusinessTimezone(
                                  code === "IR"
                                    ? "Asia/Tehran"
                                    : getBrowserTimeZone()
                                );
                              }
                            }}
                            className={
                              "ring-focus rounded-2xl px-4 py-3 text-sm font-bold transition-transform active:scale-[0.98] " +
                              (editBusinessCountry === code
                                ? "btn-selected"
                                : "bg-white text-[#1A1F36] shadow-soft")
                            }
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
                          onClick={() =>
                            saveBusinessEdit(selectedBusiness.id)
                          }
                          disabled={savingBusinessEdit}
                          className={BTN_PRIMARY}
                        >
                          {savingBusinessEdit && (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                          {savingBusinessEdit
                            ? tSvc("saving")
                            : tSvc("saveButton")}
                        </button>

                        <button
                          type="button"
                          onClick={() => setEditingBusiness(false)}
                          className={BTN_GHOST}
                        >
                          {tSvc("cancelButton")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className={CARD_INNER}>
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-[#1A1F36]/60">
                          <LinkIcon className="h-3.5 w-3.5" />
                          {tBiz("bookingLinkLabel")}
                        </div>

                        <p className="mt-2 break-all text-sm font-bold text-[#1A1F36]">
                          {bookingUrl}
                        </p>

                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => copyBookingLink(bookingUrl)}
                            className={BTN_GHOST}
                          >
                            {linkCopied ? (
                              <>
                                <Check className="h-4 w-4 text-[#34C759]" />
                                {tBiz("copied")}
                              </>
                            ) : (
                              <>
                                <Copy className="h-4 w-4" />
                                {tBiz("copyLink")}
                              </>
                            )}
                          </button>

                          <a
                            href={"/book/" + selectedBusiness.slug}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={BTN_GHOST}
                          >
                            <ExternalLink className="h-4 w-4" />
                            {tBiz("openPage")}
                          </a>
                        </div>
                      </div>

                      {!adminView && (
                        <div className="mt-4 grid grid-cols-2 gap-2">
                          {isArchived ? (
                            <button
                              type="button"
                              onClick={() =>
                                reactivateBusiness(selectedBusiness)
                              }
                              disabled={reactivating}
                              className={BTN_PRIMARY + " col-span-2"}
                            >
                              {reactivating && (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              )}
                              {reactivating
                                ? tBiz("reactivating")
                                : tBiz("reactivateButton")}
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  startEditBusiness(selectedBusiness)
                                }
                                className={BTN_GHOST}
                              >
                                <Pencil className="h-4 w-4" />
                                {tBiz("editButton")}
                              </button>

                              {confirmDeleteBusiness ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    deleteBusiness(selectedBusiness.id)
                                  }
                                  disabled={deletingBusiness}
                                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FF4D5E] px-4 py-3 text-sm font-bold text-white shadow-soft transition-transform active:scale-[0.98] disabled:opacity-50"
                                >
                                  {deletingBusiness && (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  )}
                                  {deletingBusiness
                                    ? tBiz("deleting")
                                    : tBiz("confirmDelete")}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmDeleteBusiness(true)
                                  }
                                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-[#FF4D5E] shadow-soft transition-transform active:scale-[0.98]"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  {tBiz("deleteButton")}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>

              {!isArchived && (
                <>
                  <section className={CARD_MAIN}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <span className={SECTION_ICON}>
                          <Scissors className="h-5 w-5 text-[#4F5FE8]" />
                        </span>
                        <div>
                          <h2 className={SECTION_TITLE}>
                            {tSvc("listTitle")}
                          </h2>
                          {hasServices && (
                            <p className="mt-0.5 text-xs font-medium text-[#1A1F36]/60">
                              {activeServices} /{" "}
                              {selectedBusiness.services.length}
                            </p>
                          )}
                        </div>
                      </div>

                      {!adminView && !showServiceForm && hasServices && (
                        <button
                          type="button"
                          onClick={() => setShowServiceForm(true)}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft transition-transform active:scale-95"
                          aria-label={tSvc("addButton")}
                        >
                          <Plus className="h-5 w-5 text-[#4F5FE8]" />
                        </button>
                      )}
                    </div>

                    {selectedBusiness.services.length === 0 ? (
                      <p className="mt-4 text-sm font-medium text-[#1A1F36]/60">
                        {tSvc("empty")}
                      </p>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {selectedBusiness.services.map((service) => (
                          <div key={service.id} className={CARD_INNER}>
                            {editingServiceId === service.id ? (
                              <div className="space-y-3">
                                <input
                                  value={editName}
                                  onChange={(event) =>
                                    setEditName(event.target.value)
                                  }
                                  disabled={adminView}
                                  className={
                                    INPUT_BASE + " disabled:opacity-60"
                                  }
                                />

                                <textarea
                                  value={editDescription}
                                  onChange={(event) =>
                                    setEditDescription(event.target.value)
                                  }
                                  disabled={adminView}
                                  className={
                                    INPUT_BASE +
                                    " min-h-16 disabled:opacity-60"
                                  }
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
                                    className={INPUT_BASE + " tabular"}
                                  />

                                  <input
                                    value={editDuration}
                                    onChange={(event) =>
                                      setEditDuration(event.target.value)
                                    }
                                    type="number"
                                    min="1"
                                    disabled={adminView}
                                    className={
                                      INPUT_BASE +
                                      " tabular disabled:opacity-60"
                                    }
                                  />
                                </div>

                                {!adminView && (
                                  <input
                                    value={editSlotInterval}
                                    onChange={(event) =>
                                      setEditSlotInterval(event.target.value)
                                    }
                                    type="number"
                                    min="5"
                                    step="5"
                                    placeholder={tSvc(
                                      "slotIntervalPlaceholder"
                                    )}
                                    className={INPUT_BASE + " tabular"}
                                  />
                                )}

                                {!adminView && (
                                  <div>
                                    <div className="grid grid-cols-3 gap-2">
                                      {(
                                        [
                                          "NONE",
                                          "PERCENTAGE",
                                          "FIXED",
                                        ] as const
                                      ).map((type) => (
                                        <button
                                          key={type}
                                          type="button"
                                          onClick={() =>
                                            setEditDepositType(type)
                                          }
                                          className={
                                            "ring-focus rounded-2xl px-2 py-2.5 text-xs font-bold transition-transform active:scale-[0.98] " +
                                            (editDepositType === type
                                              ? "btn-selected"
                                              : "bg-white text-[#1A1F36] shadow-soft")
                                          }
                                        >
                                          {depositLabels[type]}
                                        </button>
                                      ))}
                                    </div>

                                    {editDepositType !== "NONE" && (
                                      <input
                                        value={editDepositValue}
                                        onChange={(event) =>
                                          setEditDepositValue(
                                            event.target.value
                                          )
                                        }
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className={
                                          INPUT_BASE + " tabular mt-2"
                                        }
                                      />
                                    )}
                                  </div>
                                )}

                                <div className="grid grid-cols-2 gap-2">
                                  <button
                                    type="button"
                                    onClick={() => saveEdit(service.id)}
                                    disabled={savingEdit}
                                    className={BTN_PRIMARY}
                                  >
                                    {savingEdit && (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    )}
                                    {savingEdit
                                      ? tSvc("saving")
                                      : tSvc("saveButton")}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={cancelEdit}
                                    className={BTN_GHOST}
                                  >
                                    {tSvc("cancelButton")}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-start justify-between gap-4">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h3 className="font-bold text-[#1A1F36]">
                                        {service.name}
                                      </h3>
                                      <span
                                        className={
                                          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold shadow-soft " +
                                          (service.active
                                            ? "bg-[#34C759] text-white"
                                            : "bg-[#1A1F36]/15 text-[#1A1F36]/70")
                                        }
                                      >
                                        <span
                                          className={
                                            "h-1.5 w-1.5 rounded-full " +
                                            (service.active
                                              ? "bg-white"
                                              : "bg-[#1A1F36]/60")
                                          }
                                        />
                                        {service.active
                                          ? tSvc("activate")
                                          : tSvc("inactiveTag")}
                                      </span>
                                    </div>

                                    {service.description && (
                                      <p className="mt-1 line-clamp-2 text-xs font-medium text-[#1A1F36]/60">
                                        {service.description}
                                      </p>
                                    )}

                                    {service.depositType !== "NONE" && (
                                      <p className="mt-1 text-xs font-bold text-[#4F5FE8]">
                                        {tSvc("depositInfo", {
                                          type: depositLabels[
                                            service.depositType
                                          ],
                                          value:
                                            service.depositType ===
                                            "PERCENTAGE"
                                              ? service.depositValue + "%"
                                              : formatPrice(
                                                  service.depositValue,
                                                  service.currency
                                                ),
                                        })}
                                      </p>
                                    )}
                                  </div>

                                  <div className="shrink-0 text-end text-sm">
                                    <div className="tabular font-bold text-[#1A1F36]">
                                      {formatPrice(
                                        service.price,
                                        service.currency
                                      )}
                                    </div>
                                    <div className="mt-0.5 flex items-center justify-end gap-1 text-xs font-medium text-[#1A1F36]/60">
                                      <Clock className="h-3 w-3" />
                                      {tSvc("minutes", {
                                        count: service.durationMinutes,
                                      })}
                                    </div>
                                  </div>
                                </div>

                                {adminView ? (
                                  <div className="mt-3 grid grid-cols-1 gap-2">
                                    <button
                                      type="button"
                                      onClick={() => startEdit(service)}
                                      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#4F5FE8]/30 bg-[#4F5FE8]/5 px-4 py-3 text-sm font-bold text-[#4F5FE8] transition-transform active:scale-[0.98]"
                                    >
                                      <Pencil className="h-4 w-4" />
                                      {tSvc("editButton")}
                                    </button>
                                  </div>
                                ) : (
                                  <div className="mt-3 grid grid-cols-3 gap-2">
                                    <button
                                      type="button"
                                      onClick={() => startEdit(service)}
                                      className={BTN_GHOST}
                                    >
                                      <Pencil className="h-4 w-4" />
                                      {tSvc("editButton")}
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => toggleActive(service)}
                                      className={BTN_GHOST}
                                    >
                                      <Power className="h-4 w-4" />
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
                                        disabled={
                                          deletingId === service.id
                                        }
                                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FF4D5E] px-4 py-3 text-sm font-bold text-white shadow-soft transition-transform active:scale-[0.98] disabled:opacity-50"
                                      >
                                        {deletingId === service.id ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          <Check className="h-4 w-4" />
                                        )}
                                        {tSvc("confirmDelete")}
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setConfirmDeleteId(service.id)
                                        }
                                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-[#FF4D5E] shadow-soft transition-transform active:scale-[0.98]"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                        {tSvc("deleteButton")}
                                      </button>
                                    )}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {!adminView && showServiceForm && (
                      <form
                        onSubmit={createService}
                        className="mt-4 space-y-3 rounded-2xl bg-white p-4 shadow-soft"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#4F5FE8]/10">
                              <Plus className="h-4 w-4 text-[#4F5FE8]" />
                            </span>
                            <h3 className="text-sm font-bold text-[#1A1F36]">
                              {tSvc("addTitle")}
                            </h3>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              resetServiceForm();
                              setShowServiceForm(false);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1A1F36]/10 text-[#1A1F36] transition-colors hover:bg-[#1A1F36]/20"
                            aria-label={tSvc("cancelButton")}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <input
                          value={serviceName}
                          onChange={(event) =>
                            setServiceName(event.target.value)
                          }
                          placeholder={tSvc("namePlaceholder")}
                          className={INPUT_BASE}
                        />

                        <textarea
                          value={serviceDescription}
                          onChange={(event) =>
                            setServiceDescription(event.target.value)
                          }
                          placeholder={tSvc("descPlaceholder")}
                          className={INPUT_BASE + " min-h-20"}
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
                            className={INPUT_BASE + " tabular"}
                          />

                          <input
                            value={serviceDuration}
                            onChange={(event) =>
                              setServiceDuration(event.target.value)
                            }
                            type="number"
                            min="1"
                            placeholder={tSvc("durationPlaceholder")}
                            className={INPUT_BASE + " tabular"}
                          />
                        </div>

                        <input
                          value={serviceSlotInterval}
                          onChange={(event) =>
                            setServiceSlotInterval(event.target.value)
                          }
                          type="number"
                          min="5"
                          step="5"
                          placeholder={tSvc("slotIntervalPlaceholder")}
                          className={INPUT_BASE + " tabular"}
                        />

                        <div>
                          <p className={LABEL_SMALL}>
                            {tSvc("depositLabel")}
                          </p>
                          <div className="grid grid-cols-3 gap-2">
                            {(
                              ["NONE", "PERCENTAGE", "FIXED"] as const
                            ).map((type) => (
                              <button
                                key={type}
                                type="button"
                                onClick={() => setServiceDepositType(type)}
                                className={
                                  "ring-focus rounded-2xl px-2 py-2.5 text-xs font-bold transition-transform active:scale-[0.98] " +
                                  (serviceDepositType === type
                                    ? "btn-selected"
                                    : "bg-white text-[#1A1F36] shadow-soft")
                                }
                              >
                                {depositLabels[type]}
                              </button>
                            ))}
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
                              className={INPUT_BASE + " tabular mt-2"}
                            />
                          )}
                        </div>

                        <button
                          type="submit"
                          disabled={savingService}
                          className={BTN_PRIMARY}
                        >
                          {savingService && (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                          {savingService ? tSvc("adding") : tSvc("addButton")}
                        </button>
                      </form>
                    )}

                    {!adminView && !showServiceForm && !hasServices && (
                      <button
                        type="button"
                        onClick={() => setShowServiceForm(true)}
                        className={BTN_ADD_SERVICE + " mt-4"}
                      >
                        <Plus className="h-5 w-5" />
                        {tSvc("addButton")}
                      </button>
                    )}
                  </section>

                  <BookingsPanel businessId={selectedBusiness.id} />

                  {!adminView && (
                    <>
                      <PaymentMethodPanel
                        businessId={selectedBusiness.id}
                      />
                      <TimeOffPanel businessId={selectedBusiness.id} />
                    </>
                  )}

                  <WorkingHoursEditor businessId={selectedBusiness.id} />
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
    <main className="min-h-screen">
      <TelegramAuthGate>
        {(user) => <Dashboard user={user} />}
      </TelegramAuthGate>
    </main>
  );
}
