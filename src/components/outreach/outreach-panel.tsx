"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  composeCampaignMessage,
  describeComposeError,
  messageDirection,
  previewCampaignMessage,
} from "@/lib/outreach/message";
import {
  FUNNEL_STAGE_LABELS,
  type FunnelStageKey,
} from "@/lib/outreach/analytics";
import {
  Bot,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Eye,
  KeyRound,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";

/**
 * Admin-only outreach dashboard.
 *
 * Every write goes through `/api/admin/outreach/**`, which re-checks admin
 * authorization server-side. Nothing here can send a message on its own:
 * preparing creates DRAFT invitations, and delivery only happens for approved
 * invitations whose recipient has already started the bot.
 */

type Tab =
  | "overview"
  | "campaigns"
  | "prospects"
  | "invitations"
  | "templates"
  | "keywords"
  | "discovery"
  | "bot";

const TABS: Tab[] = [
  "overview",
  "campaigns",
  "prospects",
  "invitations",
  "templates",
  "keywords",
  "discovery",
  "bot",
];

const CARD_MAIN = "rounded-3xl bg-[#B8D4F5] p-5 shadow-soft";
const CARD_INNER = "rounded-2xl bg-white p-4 shadow-soft";
const BTN_PRIMARY =
  "flex items-center justify-center gap-2 rounded-2xl bg-[#4F5FE8] px-4 py-2.5 text-sm font-bold text-white shadow-soft transition-transform active:scale-[0.98] disabled:opacity-50";
const BTN_OK =
  "flex items-center justify-center gap-2 rounded-2xl bg-[#34C759] px-4 py-2.5 text-sm font-bold text-white shadow-soft transition-transform active:scale-[0.98] disabled:opacity-50";
const BTN_DANGER =
  "flex items-center justify-center gap-2 rounded-2xl bg-[#FF4D5E] px-4 py-2.5 text-sm font-bold text-white shadow-soft transition-transform active:scale-[0.98] disabled:opacity-50";
const BTN_GHOST =
  "flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-bold text-[#1A1F36] shadow-soft transition-transform active:scale-[0.98] disabled:opacity-50";
const BTN_NEUTRAL =
  "flex items-center justify-center gap-2 rounded-2xl bg-white px-3 py-2 text-xs font-bold text-[#1A1F36] shadow-soft transition-transform active:scale-[0.98] disabled:opacity-50";
const INPUT =
  "w-full rounded-2xl bg-white px-3 py-2.5 text-sm font-medium text-[#1A1F36] outline-none placeholder:text-[#1A1F36]/40 shadow-soft";
const LABEL = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-[#1A1F36]/60";
const BADGE = "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold";

const PROSPECT_STATUSES = [
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "STARTED_BOT",
  "REGISTERED",
  "ACTIVATED",
  "NOT_INTERESTED",
  "DO_NOT_CONTACT",
];

const CATEGORIES = ["BARBER", "BEAUTY", "MEDICAL", "OTHER"];

/**
 * The market registry comes from the server (`GET /api/admin/outreach/campaigns`
 * → `cityRegistry`), never from a hardcoded list here. This fallback only
 * renders the four launch cities if the request predates the registry or fails,
 * so the UI degrades to the OLD behaviour rather than a broken page.
 */
const FALLBACK_CITY_REGISTRY = [
  { code: "TEHRAN", fa: "تهران", en: "Tehran", approved: true },
  { code: "MASHHAD", fa: "مشهد", en: "Mashhad", approved: true },
  { code: "SHIRAZ", fa: "شیراز", en: "Shiraz", approved: true },
  { code: "KARAJ", fa: "کرج", en: "Karaj", approved: true },
];

type CityEntry = {
  code: string;
  fa: string;
  en: string;
  region?: string;
  country?: string;
  approved: boolean;
};

function cityRegistryOf(cityData: any): CityEntry[] {
  const registry = Array.isArray(cityData?.registry) ? cityData.registry : null;
  if (!registry || registry.length === 0) return FALLBACK_CITY_REGISTRY;
  return registry;
}

function cityDisplayName(entry: CityEntry | undefined, locale: string): string {
  if (!entry) return "";
  return locale === "fa" || locale === "ar" ? entry.fa || entry.code : entry.en || entry.code;
}

/**
 * Resolve a stored city code for display. Unknown codes are rendered verbatim —
 * the UI never substitutes another city's name.
 */
function cityLabelFor(code: string | null | undefined, registry: CityEntry[], locale: string): string {
  if (!code) return "";
  const entry = registry.find((item) => item.code === code);
  if (!entry) return code;
  return cityDisplayName(entry, locale);
}
const SEGMENT_OPTIONS = ["MENS_BARBER", "WOMENS_SALON"];
const SEGMENT_FA: Record<string, string> = {
  MENS_BARBER: "آرایشگاه مردانه",
  WOMENS_SALON: "سالن زیبایی زنانه",
};
const VERIFICATION_OPTIONS = ["DISCOVERED", "VERIFIED", "REJECTED"];
const VERIFICATION_FA: Record<string, string> = {
  DISCOVERED: "کشف‌شده",
  VERIFIED: "تأییدشده",
  REJECTED: "ردشده",
};
const LANGUAGES = ["en", "fa", "ar"];
const GROUPS = ["BARBER", "BEAUTY", "MEDICAL"];

function statusColor(status: string): string {
  if (status === "ACTIVATED" || status === "REGISTERED" || status === "DELIVERED")
    return "bg-[#34C759] text-white";
  if (status === "DO_NOT_CONTACT" || status === "FAILED" || status === "NOT_INTERESTED" || status === "REJECTED")
    return "bg-[#FF4D5E] text-white";
  if (status === "APPROVED" || status === "INTERESTED" || status === "SENT" || status === "STARTED_BOT" || status === "SHORTLISTED")
    return "bg-[#FCA311] text-white";
  return "bg-[#1A1F36]/15 text-[#1A1F36]/70";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      (data as { error?: string; details?: unknown })?.error ??
        `Request failed (${response.status})`
    );
  }

  return data as T;
}

function Message({
  state,
}: {
  state: { kind: "ok" | "err"; text: string } | null;
}) {
  if (!state) return null;
  return (
    <div
      className={
        "rounded-2xl p-3.5 text-sm font-bold text-white shadow-soft " +
        (state.kind === "ok" ? "bg-[#34C759]" : "bg-[#FF4D5E]")
      }
    >
      {state.text}
    </div>
  );
}

export function OutreachPanel() {
  const t = useTranslations("outreach");
  const locale = useLocale();

  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );

  const [stats, setStats] = useState<any>(null);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [templateOptions, setTemplateOptions] = useState<any[]>([]);
  const [prospects, setProspects] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [keywords, setKeywords] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [botInfo, setBotInfo] = useState<any>(null);
  /** Market registry + message defaults, loaded with the campaigns list. */
  const [cityData, setCityData] = useState<any>(null);

  const [prospectFilter, setProspectFilter] = useState("");
  const [prospectQuery, setProspectQuery] = useState("");
  const [preview, setPreview] = useState<any>(null);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (error) {
      setMessage({
        kind: "err",
        text: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    setStats(await api("/api/admin/outreach/stats"));
  }, []);

  const loadProspects = useCallback(async () => {
    const params = new URLSearchParams();
    if (prospectFilter) params.set("status", prospectFilter);
    if (prospectQuery.trim()) params.set("q", prospectQuery.trim());
    const data = await api<any>(`/api/admin/outreach/prospects?${params.toString()}`);
    setProspects(data.prospects ?? []);
  }, [prospectFilter, prospectQuery]);

  const loadInvitations = useCallback(async () => {
    const data = await api<any>("/api/admin/outreach/invitations");
    setInvitations(data.invitations ?? []);
  }, []);

  const loadTemplates = useCallback(async () => {
    const data = await api<any>("/api/admin/outreach/templates");
    setTemplates(data.templates ?? []);
  }, []);

  const loadKeywords = useCallback(async () => {
    const data = await api<any>("/api/admin/outreach/keywords");
    setKeywords(data.keywords ?? []);
  }, []);

  const loadDiscovery = useCallback(async () => {
    const data = await api<any>("/api/admin/outreach/candidates");
    setCandidates(data.candidates ?? []);
    setRuns(data.runs ?? []);
  }, []);

  const loadSettings = useCallback(async () => {
    const data = await api<any>("/api/admin/outreach/settings");
    setSettings(data);
    return data;
  }, []);

  const loadCampaigns = useCallback(async () => {
    const data = await api<any>("/api/admin/outreach/campaigns");
    setCampaigns(data.campaigns ?? []);
    setCityData({
      registry: data.cityRegistry ?? null,
      approved: data.cities ?? [],
      maxCampaignCities: data.maxCampaignCities ?? 100,
      messageDefaults: data.messageDefaults ?? null,
    });
    const templates = await api<any>("/api/admin/outreach/templates");
    setTemplateOptions(templates.templates ?? []);
  }, []);

  const loadBot = useCallback(async () => {
    setBotInfo(await api("/api/admin/telegram/webhook"));
  }, []);

  useEffect(() => {
    void loadStats().catch(() => undefined);
  }, [loadStats]);

  useEffect(() => {
    if (tab === "campaigns") void loadCampaigns().catch(() => undefined);
    if (tab === "prospects") void loadProspects().catch(() => undefined);
    if (tab === "invitations") void loadInvitations().catch(() => undefined);
    if (tab === "templates") void loadTemplates().catch(() => undefined);
    if (tab === "keywords") void loadKeywords().catch(() => undefined);
    if (tab === "discovery") {
      void loadDiscovery().catch((error) =>
        setMessage({
          kind: "err",
          text: error instanceof Error ? error.message : "Request failed",
        })
      );
      void loadSettings().catch((error) =>
        setMessage({
          kind: "err",
          text: error instanceof Error ? error.message : "Request failed",
        })
      );
    }
    if (tab === "bot") void loadBot().catch(() => undefined);
  }, [
    tab,
    loadProspects,
    loadInvitations,
    loadTemplates,
    loadKeywords,
    loadDiscovery,
    loadSettings,
    loadBot,
  ]);

  function copy(text: string) {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setMessage({ kind: "ok", text: t("copied") });
  }

  /* ------------------------------------------------------------------ */

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              "shrink-0 rounded-2xl px-4 py-2.5 text-xs font-bold transition-all active:scale-95 " +
              (tab === key
                ? "btn-selected"
                : "bg-white text-[#1A1F36] shadow-soft")
            }
          >
            {t(`tab.${key}`)}
          </button>
        ))}
      </div>

      <Message state={message} />

      {busy && (
        <div className="flex items-center gap-2 text-sm text-[#1A1F36]/60">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
        </div>
      )}

      {tab === "overview" && stats && (
        <Overview stats={stats} locale={locale} onReload={() => run(loadStats)} />
      )}

      {tab === "campaigns" && (
        <CampaignsTab
          campaigns={campaigns}
          templates={templateOptions}
          cityData={cityData}
          run={run}
          refresh={loadCampaigns}
          setMessage={setMessage}
        />
      )}

      {tab === "prospects" && (
        <ProspectsTab
          cityData={cityData}
          prospects={prospects}
          filter={prospectFilter}
          setFilter={setProspectFilter}
          query={prospectQuery}
          setQuery={setProspectQuery}
          onReload={() => run(loadProspects)}
          onCopy={copy}
          run={run}
          refresh={loadProspects}
          setMessage={setMessage}
        />
      )}

      {tab === "invitations" && (
        <InvitationsTab
          invitations={invitations}
          onReload={() => run(loadInvitations)}
          onPreview={setPreview}
          onCopy={copy}
          run={run}
          refresh={loadInvitations}
          setMessage={setMessage}
        />
      )}

      {tab === "templates" && (
        <TemplatesTab
          templates={templates}
          run={run}
          refresh={loadTemplates}
        />
      )}

      {tab === "keywords" && (
        <KeywordsTab keywords={keywords} run={run} refresh={loadKeywords} />
      )}

      {tab === "discovery" && (
        <DiscoveryTab
          candidates={candidates}
          runs={runs}
          settings={settings}
          run={run}
          refresh={() => loadDiscovery()}
          refreshSettings={loadSettings}
          setMessage={setMessage}
        />
      )}

      {tab === "bot" && (
        <BotTab
          info={botInfo}
          run={run}
          refresh={loadBot}
          setMessage={setMessage}
        />
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-3xl bg-[#B8D4F5] p-5 shadow-elevated">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-bold text-[#1A1F36]">
                {t("previewTitle")}
              </h3>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded-lg p-1 text-[#1A1F36]/60 hover:bg-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-3 whitespace-pre-wrap rounded-2xl bg-white p-4 text-sm font-medium leading-7 text-[#1A1F36] shadow-soft">
              {preview.body}
            </p>

            <p className="mt-2 break-all rounded-2xl bg-white px-4 py-3 text-xs font-bold text-[#4F5FE8] shadow-soft">
              {preview.deepLink}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => copy(preview.body + "\n\n" + preview.deepLink)}
                className={BTN_GHOST}
              >
                <ClipboardCopy className="h-4 w-4" />
                {t("copy")}
              </button>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className={BTN_PRIMARY}
              >
                {t("close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Overview                                                                */
/* ---------------------------------------------------------------------- */

function Overview({
  stats,
  locale,
  onReload,
}: {
  stats: any;
  locale: string;
  onReload: () => void;
}) {
  const t = useTranslations("outreach");
  const funnel: any[] = stats.funnel ?? [];
  const max = Math.max(1, ...funnel.map((step) => step.count));

  return (
    <div className="space-y-4">
      <section className={CARD_MAIN}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-[#1A1F36]">{t("funnelTitle")}</h2>
          <button type="button" onClick={onReload} className="rounded-lg p-1.5 hover:bg-white">
            <RefreshCw className="h-4 w-4 text-[#1A1F36]/60" />
          </button>
        </div>
        <p className="mt-0.5 text-xs text-[#1A1F36]/60">{t("funnelSubtitle")}</p>

        <div className="mt-4 space-y-2">
          {funnel.map((step) => (
            <div key={step.event} className={CARD_INNER}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold text-[#1A1F36]">
                  {locale === "fa" ? step.labelFa : step.labelEn}
                </span>
                <span className="text-sm font-bold text-[#4F5FE8]">{step.count}</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#1A1F36]/10">
                <div
                  className="h-full rounded-full bg-[#4F5FE8]"
                  style={{ width: `${Math.round((step.count / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={CARD_MAIN}>
        <h2 className="text-base font-bold text-[#1A1F36]">{t("acquisitionTitle")}</h2>
        <p className="mt-0.5 text-xs text-[#1A1F36]/60">{t("acquisitionNote")}</p>

        <div className="mt-3 space-y-2">
          {(stats.acquisition?.stages ?? []).map((stage: any) => (
            <div key={stage.key} className={`${CARD_INNER} flex items-start justify-between gap-3 py-2.5`}>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#1A1F36]">
                  {(FUNNEL_STAGE_LABELS[stage.key as FunnelStageKey] ?? { en: stage.key })[
                    locale === "fa" ? "fa" : "en"
                  ] ?? stage.key}
                </p>
                <p className="mt-0.5 text-[10px] font-medium text-[#1A1F36]/45" dir="ltr">
                  {stage.source}
                </p>
              </div>
              <div className="shrink-0 text-end">
                <p className={`text-sm font-extrabold ${stage.measured ? "text-[#4F5FE8]" : "text-[#1A1F36]/30"}`}>
                  {stage.measured ? stage.count : t("notMeasured")}
                </p>
                {stage.conversionFromPrev != null && (
                  <p className="text-[10px] font-bold text-[#248A3D]">
                    {t("conversion")} {(stage.conversionFromPrev * 100).toFixed(1)}%
                  </p>
                )}
              </div>
            </div>
          ))}
          {(stats.acquisition?.stages ?? []).length === 0 && (
            <p className="text-sm text-[#1A1F36]/60">{t("empty")}</p>
          )}
        </div>

        <div className="mt-3 space-y-2">
          {(stats.acquisition?.byCampaign ?? []).slice(0, 8).map((row: any) => (
            <div key={row.id} className={`${CARD_INNER} py-2.5`}>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-bold text-[#1A1F36]">{row.name}</p>
                <span className={`${BADGE} shrink-0 bg-[#1A1F36]/10 text-[#1A1F36]/70`}>{row.status}</span>
              </div>
              <p className="mt-1 text-[11px] font-medium text-[#1A1F36]/60" dir="ltr">
                {row.prospects} {t("pipelineTitle")} · {row.invitationsDrafted} {t("prepared")} ·{" "}
                {row.invitationsDelivered} {t("delivered")} · {row.botStarts} {t("botStarts")} ·{" "}
                {row.registrations} {t("registrations")}
                {row.activationRate != null ? ` · ${(row.activationRate * 100).toFixed(1)}%` : ""}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-3 overflow-x-auto">
          {(stats.acquisition?.byCity ?? []).length > 0 && (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-[#1A1F36]/60">
                  <th className="py-1 text-start">{t("city")}</th>
                  <th className="py-1 text-end">{t("verified")}</th>
                  <th className="py-1 text-end">{t("prepared")}</th>
                  <th className="py-1 text-end">{t("delivered")}</th>
                </tr>
              </thead>
              <tbody>
                {stats.acquisition.byCity.slice(0, 10).map((row: any) => (
                  <tr key={row.key} className="font-bold text-[#1A1F36]">
                    <td className="py-1">{row.key}</td>
                    <td className="py-1 text-end">{row.verified}</td>
                    <td className="py-1 text-end">{row.drafted}</td>
                    <td className="py-1 text-end">{row.delivered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className={CARD_MAIN}>
        <h2 className="text-base font-bold text-[#1A1F36]">{t("pipelineTitle")}</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {PROSPECT_STATUSES.map((status) => (
            <div key={status} className={CARD_INNER}>
              <span className={`${BADGE} ${statusColor(status)}`}>{status}</span>
              <p className="mt-2 text-lg font-bold text-[#1A1F36]">
                {stats.prospects?.byStatus?.[status] ?? 0}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-[#1A1F36]/60">
          {t("dueFollowUps")}: <b>{stats.prospects?.dueFollowUps ?? 0}</b>
        </p>
      </section>

      <section className={CARD_MAIN}>
        <h2 className="text-base font-bold text-[#1A1F36]">{t("lastRunTitle")}</h2>
        {stats.discovery?.lastRun ? (
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-medium text-[#1A1F36]">
            <Stat label="runDate" value={stats.discovery.lastRun.runDate} />
            <Stat label="status" value={stats.discovery.lastRun.status} />
            <Stat label="discovered" value={stats.discovery.lastRun.discovered} />
            <Stat label="duplicates" value={stats.discovery.lastRun.duplicates} />
            <Stat label="excluded" value={stats.discovery.lastRun.excluded} />
            <Stat label="prepared" value={stats.discovery.lastRun.invitationsPrepared} />
            <Stat label="delivered" value={stats.discovery.lastRun.messagesDelivered} />
            <Stat label="error" value={stats.discovery.lastRun.error ?? "—"} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-[#1A1F36]/60">{t("noRuns")}</p>
        )}

        <div className="mt-3 rounded-2xl bg-white p-3 text-xs font-medium text-[#1A1F36]/70 shadow-soft">
          {t("last24h")}: {stats.last24h?.botStarts ?? 0} {t("botStarts")} ·{" "}
          {stats.last24h?.registrations ?? 0} {t("registrations")} ·{" "}
          {stats.last24h?.activations ?? 0} {t("activations")} ·{" "}
          {stats.last24h?.firstBookings ?? 0} {t("firstBookings")}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow-soft">
      <p className="text-[10px] font-bold uppercase text-[#1A1F36]/50">{label}</p>
      <p className="mt-0.5 truncate font-bold">{String(value)}</p>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Prospects                                                               */
/* ---------------------------------------------------------------------- */

function ProspectsTab({
  cityData,
  prospects,
  filter,
  setFilter,
  query,
  setQuery,
  onReload,
  onCopy,
  run,
  refresh,
  setMessage,
}: any) {
  const t = useTranslations("outreach");
  const locale = useLocale();
  const cityRegistry = cityRegistryOf(cityData);
  const approvedCities = cityRegistry.filter((entry) => entry.approved);
  const otherCities = cityRegistry.filter((entry) => !entry.approved);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    publicName: "",
    category: "BARBER",
    city: "",
    segment: "",
    neighborhood: "",
    language: "fa",
    publicUrl: "",
    telegramUsername: "",
    sourceUrl: "",
    verificationStatus: "VERIFIED",
    verificationEvidence: "",
    notes: "",
  });

  async function create() {
    await run(async () => {
      await api("/api/admin/outreach/prospects", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          city: form.city || null,
          segment: form.segment || null,
          neighborhood: form.neighborhood || null,
          publicUrl: form.publicUrl || null,
          telegramUsername: form.telegramUsername || null,
          sourceUrl: form.sourceUrl || null,
          verificationEvidence: form.verificationEvidence || null,
          notes: form.notes || null,
        }),
      });
      setOpen(false);
      setForm({
        publicName: "",
        category: "BARBER",
        city: "",
        segment: "",
        neighborhood: "",
        language: "fa",
        publicUrl: "",
        telegramUsername: "",
        sourceUrl: "",
        verificationStatus: "VERIFIED",
        verificationEvidence: "",
        notes: "",
      });
      await refresh();
      setMessage({ kind: "ok", text: t("saved") });
    });
  }

  async function setStatus(id: string, status: string) {
    await run(async () => {
      await api(`/api/admin/outreach/prospects/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await refresh();
    });
  }

  async function remove(id: string) {
    await run(async () => {
      await api(`/api/admin/outreach/prospects/${id}`, { method: "DELETE" });
      await refresh();
    });
  }

  return (
    <div className="space-y-4">
      <section className={CARD_MAIN}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-[#1A1F36]">{t("prospectsTitle")}</h2>
          <button type="button" onClick={() => setOpen(!open)} className={BTN_PRIMARY}>
            <Plus className="h-4 w-4" />
            {t("addProspect")}
          </button>
        </div>

        <p className="mt-1 text-xs text-[#1A1F36]/60">{t("prospectsHelp")}</p>

        {open && (
          <div className="mt-4 space-y-3">
            <div>
              <label className={LABEL}>{t("publicName")}</label>
              <input
                value={form.publicName}
                onChange={(e) => setForm({ ...form, publicName: e.target.value })}
                className={INPUT}
                placeholder={t("publicNamePlaceholder")}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={LABEL}>{t("category")}</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className={INPUT}
                >
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL}>{t("language")}</label>
                <select
                  value={form.language}
                  onChange={(e) => setForm({ ...form, language: e.target.value })}
                  className={INPUT}
                >
                  {LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={LABEL}>{t("city")}</label>
                <select
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className={INPUT}
                >
                  <option value="">{t("cityUnassigned")}</option>
                  <optgroup label={t("approvedMarkets")}>
                    {approvedCities.map((entry) => (
                      <option key={entry.code} value={entry.code}>
                        {cityDisplayName(entry, locale)}
                      </option>
                    ))}
                  </optgroup>
                  {otherCities.length > 0 && (
                    <optgroup label={t("otherMarkets")}>
                      {otherCities.map((entry) => (
                        <option key={entry.code} value={entry.code}>
                          {cityDisplayName(entry, locale)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              <div>
                <label className={LABEL}>{t("segment")}</label>
                <select
                  value={form.segment}
                  onChange={(e) => setForm({ ...form, segment: e.target.value })}
                  className={INPUT}
                >
                  <option value="">{t("segmentAuto")}</option>
                  {SEGMENT_OPTIONS.map((segment) => (
                    <option key={segment} value={segment}>
                      {SEGMENT_FA[segment]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={LABEL}>{t("neighborhood")}</label>
                <input
                  value={form.neighborhood}
                  onChange={(e) =>
                    setForm({ ...form, neighborhood: e.target.value })
                  }
                  className={INPUT}
                />
              </div>
              <div>
                <label className={LABEL}>{t("verificationStatus")}</label>
                <select
                  value={form.verificationStatus}
                  onChange={(e) =>
                    setForm({ ...form, verificationStatus: e.target.value })
                  }
                  className={INPUT}
                >
                  {VERIFICATION_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {VERIFICATION_FA[status]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={LABEL}>{t("telegramUsername")}</label>
                <input
                  value={form.telegramUsername}
                  onChange={(e) =>
                    setForm({ ...form, telegramUsername: e.target.value })
                  }
                  className={INPUT}
                  placeholder="@shop"
                  dir="ltr"
                />
              </div>
            </div>

            <div>
              <label className={LABEL}>{t("publicUrl")}</label>
              <input
                value={form.publicUrl}
                onChange={(e) => setForm({ ...form, publicUrl: e.target.value })}
                className={INPUT}
                placeholder="https://..."
                dir="ltr"
              />
            </div>

            <div>
              <label className={LABEL}>{t("verificationEvidence")}</label>
              <input
                value={form.verificationEvidence}
                onChange={(e) =>
                  setForm({ ...form, verificationEvidence: e.target.value })
                }
                className={INPUT}
                placeholder={t("verificationEvidencePlaceholder")}
              />
            </div>

            <div>
              <label className={LABEL}>{t("sourceUrl")}</label>
              <input
                value={form.sourceUrl}
                onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
                className={INPUT}
                placeholder="https://..."
                dir="ltr"
              />
            </div>

            <div>
              <label className={LABEL}>{t("notes")}</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className={INPUT + " min-h-20"}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={create} className={BTN_OK}>
                <Check className="h-4 w-4" />
                {t("save")}
              </button>
              <button type="button" onClick={() => setOpen(false)} className={BTN_GHOST}>
                {t("cancel")}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className={CARD_MAIN}>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#1A1F36]/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onReload();
              }}
              placeholder={t("searchProspects")}
              className={INPUT + " ps-9"}
            />
          </div>
          <button type="button" onClick={onReload} className={BTN_GHOST}>
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => {
              setFilter("");
              setTimeout(onReload, 0);
            }}
            className={
              "shrink-0 rounded-2xl px-3 py-2 text-[10px] font-bold " +
              (filter === "" ? "btn-selected" : "bg-white text-[#1A1F36] shadow-soft")
            }
          >
            ALL
          </button>
          {PROSPECT_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => {
                setFilter(status);
                setTimeout(onReload, 0);
              }}
              className={
                "shrink-0 rounded-2xl px-3 py-2 text-[10px] font-bold " +
                (filter === status
                  ? "btn-selected"
                  : "bg-white text-[#1A1F36] shadow-soft")
              }
            >
              {status}
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-3">
          {prospects.length === 0 && (
            <p className="text-sm text-[#1A1F36]/60">{t("empty")}</p>
          )}

          {prospects.map((prospect: any) => (
            <div key={prospect.id} className={CARD_INNER}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[#1A1F36]">
                    {prospect.publicName}
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-[#1A1F36]/60">
                    {prospect.city
                      ? cityLabelFor(prospect.city, cityRegistry, locale) || t("cityUnassigned")
                      : t("cityUnassigned")}
                    {prospect.segment
                      ? ` · ${SEGMENT_FA[prospect.segment] ?? prospect.segment}`
                      : ""}
                    {prospect.neighborhood ? ` · ${prospect.neighborhood}` : ""}
                    {prospect.language ? ` · ${prospect.language}` : ""}
                    {prospect.verificationStatus &&
                    prospect.verificationStatus !== "VERIFIED"
                      ? ` · ${VERIFICATION_FA[prospect.verificationStatus] ?? prospect.verificationStatus}`
                      : ""}
                  </p>
                </div>
                <span className={`${BADGE} ${statusColor(prospect.status)}`}>
                  {prospect.status}
                </span>
              </div>

              {prospect.telegramUsername && (
                <a
                  href={prospect.telegramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block truncate text-xs font-bold text-[#4F5FE8]"
                  dir="ltr"
                >
                  {prospect.telegramUrl}
                </a>
              )}

              {prospect.publicUrl && !prospect.telegramUsername && (
                <a
                  href={prospect.publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block truncate text-xs font-bold text-[#4F5FE8]"
                  dir="ltr"
                >
                  {prospect.publicUrl}
                </a>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <select
                  value={prospect.status}
                  onChange={(e) => void setStatus(prospect.id, e.target.value)}
                  className="rounded-xl bg-[#1A1F36]/5 px-3 py-2 text-xs font-bold text-[#1A1F36]"
                >
                  {PROSPECT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => onCopy(prospect.manualDeepLink)}
                  className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#1A1F36] shadow-soft"
                >
                  <ClipboardCopy className="me-1 inline h-3.5 w-3.5" />
                  {t("copyLink")}
                </button>

                <button
                  type="button"
                  onClick={() => void remove(prospect.id)}
                  className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#FF4D5E] shadow-soft"
                >
                  <Trash2 className="me-1 inline h-3.5 w-3.5" />
                  {t("delete")}
                </button>
              </div>

              <p className="mt-2 text-[10px] font-medium text-[#1A1F36]/50">
                {t("followUp")}: {formatDate(prospect.nextFollowUpAt)} ·{" "}
                {t("contacted")}: {prospect.contactedCount}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Invitations                                                             */
/* ---------------------------------------------------------------------- */

function InvitationsTab({
  invitations,
  onReload,
  onPreview,
  onCopy,
  run,
  refresh,
  setMessage,
}: any) {
  const t = useTranslations("outreach");
  const [count, setCount] = useState(10);

  async function prepare() {
    await run(async () => {
      const data = await api<any>("/api/admin/outreach/invitations", {
        method: "POST",
        body: JSON.stringify({ count }),
      });
      await refresh();
      setMessage({ kind: "ok", text: `${t("prepared")}: ${data.prepared?.length ?? 0}` });
    });
  }

  async function act(id: string, action: string) {
    await run(async () => {
      await api(`/api/admin/outreach/invitations/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      await refresh();
    });
  }

  return (
    <div className="space-y-4">
      <section className={CARD_MAIN}>
        <h2 className="text-base font-bold text-[#1A1F36]">{t("prepareTitle")}</h2>
        <p className="mt-1 text-xs text-[#1A1F36]/60">{t("prepareHelp")}</p>

        <div className="mt-4 flex gap-2">
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className={INPUT + " w-24"}
          />
          <button type="button" onClick={prepare} className={BTN_PRIMARY}>
            <Sparkles className="h-4 w-4" />
            {t("prepare")}
          </button>
          <button type="button" onClick={onReload} className={BTN_GHOST}>
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </section>

      <section className={CARD_MAIN}>
        <h2 className="text-base font-bold text-[#1A1F36]">{t("invitationsTitle")}</h2>

        <div className="mt-3 space-y-3">
          {invitations.length === 0 && (
            <p className="text-sm text-[#1A1F36]/60">{t("empty")}</p>
          )}

          {invitations.map((invitation: any) => (
            <div key={invitation.id} className={CARD_INNER}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[#1A1F36]">
                    {invitation.prospect?.publicName ?? "—"}
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-[#1A1F36]/60">
                    {invitation.language} · {formatDate(invitation.createdAt)}
                  </p>
                </div>
                <span className={`${BADGE} ${statusColor(invitation.status)}`}>
                  {invitation.status}
                </span>
              </div>

              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs font-medium leading-6 text-[#1A1F36]/70">
                {invitation.body}
              </p>

              {invitation.failureReason && (
                <p className="mt-2 rounded-xl bg-[#FF4D5E]/10 px-3 py-2 text-[11px] font-bold text-[#FF4D5E]">
                  {invitation.failureReason}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onPreview(invitation)}
                  className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#1A1F36] shadow-soft"
                >
                  <Eye className="me-1 inline h-3.5 w-3.5" />
                  {t("preview")}
                </button>

                <button
                  type="button"
                  onClick={() => onCopy(invitation.body + "\n\n" + invitation.deepLink)}
                  className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#1A1F36] shadow-soft"
                >
                  <ClipboardCopy className="me-1 inline h-3.5 w-3.5" />
                  {t("copy")}
                </button>

                {invitation.status === "DRAFT" && (
                  <>
                    <button
                      type="button"
                      onClick={() => void act(invitation.id, "approve")}
                      className="rounded-xl bg-[#34C759] px-3 py-2 text-xs font-bold text-white shadow-soft"
                    >
                      <Check className="me-1 inline h-3.5 w-3.5" />
                      {t("approve")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void act(invitation.id, "reject")}
                      className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#FF4D5E] shadow-soft"
                    >
                      <XCircle className="me-1 inline h-3.5 w-3.5" />
                      {t("reject")}
                    </button>
                  </>
                )}

                {invitation.status === "APPROVED" && (
                  <button
                    type="button"
                    onClick={() => void act(invitation.id, "mark_manual_sent")}
                    className="rounded-xl bg-[#FCA311] px-3 py-2 text-xs font-bold text-white shadow-soft"
                  >
                    <Mail className="me-1 inline h-3.5 w-3.5" />
                    {t("markManualSent")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Templates                                                               */
/* ---------------------------------------------------------------------- */

function TemplatesTab({ templates, run, refresh }: any) {
  const t = useTranslations("outreach");
  const [form, setForm] = useState({
    code: "",
    language: "en",
    category: "ALL",
    body: "",
  });

  async function create() {
    await run(async () => {
      await api("/api/admin/outreach/templates", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm({ code: "", language: "en", category: "ALL", body: "" });
      await refresh();
    });
  }

  async function toggle(id: string, active: boolean) {
    await run(async () => {
      await api(`/api/admin/outreach/templates/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !active }),
      });
      await refresh();
    });
  }

  return (
    <div className="space-y-4">
      <section className={CARD_MAIN}>
        <h2 className="text-base font-bold text-[#1A1F36]">{t("templatesTitle")}</h2>
        <p className="mt-1 text-xs text-[#1A1F36]/60">{t("templatesHelp")}</p>

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={LABEL}>{t("language")}</label>
              <select
                value={form.language}
                onChange={(e) => setForm({ ...form, language: e.target.value })}
                className={INPUT}
              >
                {LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>{t("category")}</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className={INPUT}
              >
                <option value="ALL">ALL</option>
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>{t("code")}</label>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className={INPUT}
                placeholder="invite_en_v2"
                dir="ltr"
              />
            </div>
          </div>

          <div>
            <label className={LABEL}>{t("body")}</label>
            <textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              className={INPUT + " min-h-40 font-mono text-xs"}
              placeholder={"Hi {businessName}\n\n...\n\n{link}"}
            />
            <p className="mt-1.5 text-[11px] text-[#1A1F36]/60">
              {"{businessName} · {link} · {category}"}
            </p>
          </div>

          <button type="button" onClick={create} className={BTN_PRIMARY}>
            <Plus className="h-4 w-4" />
            {t("addTemplate")}
          </button>
        </div>
      </section>

      <section className={CARD_MAIN}>
        <h2 className="text-base font-bold text-[#1A1F36]">{t("existingTemplates")}</h2>
        <div className="mt-3 space-y-3">
          {templates.length === 0 && (
            <p className="text-sm text-[#1A1F36]/60">{t("noTemplates")}</p>
          )}
          {templates.map((template: any) => (
            <div key={template.id} className={CARD_INNER}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[#1A1F36]" dir="ltr">
                    {template.code}
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-[#1A1F36]/60">
                    {template.language} · {template.category}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void toggle(template.id, template.active)}
                  className={
                    "rounded-xl px-3 py-2 text-xs font-bold text-white shadow-soft " +
                    (template.active ? "bg-[#34C759]" : "bg-[#1A1F36]/30")
                  }
                >
                  {template.active ? t("active") : t("inactive")}
                </button>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-xs font-medium leading-6 text-[#1A1F36]/70">
                {template.body}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Keywords                                                                */
/* ---------------------------------------------------------------------- */

function KeywordsTab({ keywords, run, refresh }: any) {
  const t = useTranslations("outreach");
  const [form, setForm] = useState({
    term: "",
    group: "BARBER",
    language: "en",
    priority: 3,
  });

  async function add() {
    await run(async () => {
      await api("/api/admin/outreach/keywords", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm({ ...form, term: "" });
      await refresh();
    });
  }

  async function seed() {
    await run(async () => {
      await api("/api/admin/outreach/keywords", { method: "PUT" });
      await refresh();
    });
  }

  async function patch(id: string, data: Record<string, unknown>) {
    await run(async () => {
      await api(`/api/admin/outreach/keywords/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      await refresh();
    });
  }

  async function remove(id: string) {
    await run(async () => {
      await api(`/api/admin/outreach/keywords/${id}`, { method: "DELETE" });
      await refresh();
    });
  }

  return (
    <div className="space-y-4">
      <section className={CARD_MAIN}>
        <h2 className="text-base font-bold text-[#1A1F36]">{t("keywordsTitle")}</h2>
        <p className="mt-1 text-xs text-[#1A1F36]/60">{t("keywordsHelp")}</p>

        <div className="mt-4 grid grid-cols-4 gap-2">
          <div className="col-span-4">
            <label className={LABEL}>{t("term")}</label>
            <input
              value={form.term}
              onChange={(e) => setForm({ ...form, term: e.target.value })}
              className={INPUT}
              placeholder="barbershop / آرایشگاه مردانه"
            />
          </div>
          <div>
            <label className={LABEL}>{t("group")}</label>
            <select
              value={form.group}
              onChange={(e) => setForm({ ...form, group: e.target.value })}
              className={INPUT}
            >
              {GROUPS.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL}>{t("language")}</label>
            <select
              value={form.language}
              onChange={(e) => setForm({ ...form, language: e.target.value })}
              className={INPUT}
            >
              {LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL}>{t("priority")}</label>
            <input
              type="number"
              min={1}
              max={5}
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
              className={INPUT}
            />
          </div>
          <div className="flex items-end">
            <button type="button" onClick={add} className={BTN_PRIMARY + " w-full"}>
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <button type="button" onClick={seed} className={BTN_GHOST + " mt-3 w-full"}>
          <Sparkles className="h-4 w-4" />
          {t("seedDefaults")}
        </button>
      </section>

      <section className={CARD_MAIN}>
        <h2 className="text-base font-bold text-[#1A1F36]">{t("existingKeywords")}</h2>
        <div className="mt-3 space-y-2">
          {keywords.length === 0 && (
            <p className="text-sm text-[#1A1F36]/60">{t("noKeywords")}</p>
          )}
          {keywords.map((keyword: any) => (
            <div key={keyword.id} className={CARD_INNER}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[#1A1F36]">
                    {keyword.term}
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-[#1A1F36]/60">
                    {keyword.group} · {keyword.language} · p{keyword.priority}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => void patch(keyword.id, { enabled: !keyword.enabled })}
                    className={
                      "rounded-xl px-3 py-2 text-xs font-bold text-white shadow-soft " +
                      (keyword.enabled ? "bg-[#34C759]" : "bg-[#1A1F36]/30")
                    }
                  >
                    {keyword.enabled ? t("on") : t("off")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(keyword.id)}
                    className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#FF4D5E] shadow-soft"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Discovery                                                               */
/* ---------------------------------------------------------------------- */

function DiscoveryTab({
  candidates,
  runs,
  settings,
  run,
  refresh,
  refreshSettings,
  setMessage,
}: any) {
  const t = useTranslations("outreach");
  const [selected, setSelected] = useState<string[]>([]);
  const [seedText, setSeedText] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savingChannelUrl, setSavingChannelUrl] = useState(false);
  const [channelUrlSaveState, setChannelUrlSaveState] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const s = settings?.settings ?? {};

  async function promote() {
    await run(async () => {
      await api("/api/admin/outreach/candidates", {
        method: "POST",
        body: JSON.stringify({ candidateIds: selected }),
      });
      setSelected([]);
      await refresh();
    });
  }

  async function review(id: string, status: string) {
    await run(async () => {
      await api(`/api/admin/outreach/candidates/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await refresh();
    });
  }

  async function saveSettings(key: string, value: unknown) {
    await run(async () => {
      await api("/api/admin/outreach/settings", {
        method: "PUT",
        body: JSON.stringify({ [key]: value }),
      });
      await refreshSettings();
    });
  }

  function normalizeChannelUrl(raw: string): string | null {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return "";
    if (trimmed.length > 500) return null;

    try {
      const url = new URL(trimmed);
      if (url.protocol !== "https:" || !url.hostname) return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  async function saveChannelUrl() {
    const value = normalizeChannelUrl(draft.channelUrl ?? s.channelUrl ?? "");
    if (value === null) {
      setChannelUrlSaveState({ kind: "err", text: t("channelUrlValidationError") });
      return;
    }

    setSavingChannelUrl(true);
    setChannelUrlSaveState(null);
    try {
      await api("/api/admin/outreach/settings", {
        method: "PUT",
        body: JSON.stringify({ "outreach.channel_url": value }),
      });

      // Do not treat the PUT response as proof of persistence. Re-read through
      // the authorized settings API and only report success when it matches.
      const reloaded = await refreshSettings();
      if (reloaded?.settings?.channelUrl !== value) {
        throw new Error(t("channelUrlVerificationError"));
      }

      setDraft((current) => ({ ...current, channelUrl: reloaded.settings.channelUrl }));
      setChannelUrlSaveState({ kind: "ok", text: t("channelUrlSaved") });
    } catch (error) {
      setChannelUrlSaveState({
        kind: "err",
        text: error instanceof Error ? error.message : t("channelUrlSaveError"),
      });
    } finally {
      setSavingChannelUrl(false);
    }
  }

  async function saveSeed() {
    await run(async () => {
      const lines = seedText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const items = lines.map((line) => {
        // Accept "Name | https://url | city" or a single URL.
        const parts = line.split("|").map((part) => part.trim());
        return {
          publicName: parts[0] ?? line,
          publicUrl: parts[1] ?? null,
          city: parts[2] ?? null,
        };
      });

      await api("/api/admin/outreach/settings", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      setSeedText("");
      setMessage({ kind: "ok", text: t("saved") });
    });
  }

  return (
    <div className="space-y-4">
      <section className={CARD_MAIN}>
        <h2 className="text-base font-bold text-[#1A1F36]">{t("discoveryTitle")}</h2>
        <p className="mt-1 text-xs text-[#1A1F36]/60">{t("discoveryHelp")}</p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div>
            <label className={LABEL}>{t("dailyDiscoveryLimit")}</label>
            <input
              type="number"
              min={0}
              max={settings?.limits?.maxDailyDiscoveryLimit ?? 500}
              value={draft.discoveryLimit ?? s.dailyDiscoveryLimit ?? 50}
              onChange={(e) =>
                setDraft({ ...draft, discoveryLimit: e.target.value })
              }
              className={INPUT}
            />
            <button
              type="button"
              onClick={() =>
                void saveSettings(
                  "outreach.daily_discovery_limit",
                  Number(draft.discoveryLimit ?? s.dailyDiscoveryLimit ?? 50)
                )
              }
              className={BTN_GHOST + " mt-2 w-full text-xs"}
            >
              {t("save")}
            </button>
          </div>

          <div>
            <label className={LABEL}>{t("dailyInvitationLimit")}</label>
            <input
              type="number"
              min={0}
              max={settings?.limits?.maxDailyInvitationLimit ?? 100}
              value={draft.invitationLimit ?? s.dailyInvitationLimit ?? 10}
              onChange={(e) =>
                setDraft({ ...draft, invitationLimit: e.target.value })
              }
              className={INPUT}
            />
            <button
              type="button"
              onClick={() =>
                void saveSettings(
                  "outreach.daily_invitation_limit",
                  Number(draft.invitationLimit ?? s.dailyInvitationLimit ?? 10)
                )
              }
              className={BTN_GHOST + " mt-2 w-full text-xs"}
            >
              {t("save")}
            </button>
          </div>

          <div>
            <label className={LABEL}>{t("timezone")}</label>
            <input
              value={draft.timezone ?? s.timezone ?? "UTC"}
              onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
              className={INPUT}
              dir="ltr"
            />
            <button
              type="button"
              onClick={() => void saveSettings("outreach.timezone", draft.timezone ?? s.timezone)}
              className={BTN_GHOST + " mt-2 w-full text-xs"}
            >
              {t("save")}
            </button>
          </div>

          <div>
            <label className={LABEL}>{t("minScore")}</label>
            <input
              type="number"
              min={0}
              max={100}
              value={draft.minScore ?? s.minScore ?? 30}
              onChange={(e) => setDraft({ ...draft, minScore: e.target.value })}
              className={INPUT}
            />
            <button
              type="button"
              onClick={() =>
                void saveSettings("outreach.min_score", Number(draft.minScore ?? s.minScore ?? 30))
              }
              className={BTN_GHOST + " mt-2 w-full text-xs"}
            >
              {t("save")}
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void saveSettings("outreach.enabled", !s.enabled)}
            className={s.enabled ? BTN_OK : BTN_GHOST}
          >
            {t("discovery")}: {s.enabled ? t("on") : t("off")}
          </button>
          <button
            type="button"
            onClick={() => void saveSettings("outreach.auto_send_enabled", !s.autoSendEnabled)}
            className={s.autoSendEnabled ? BTN_OK : BTN_GHOST}
          >
            {t("autoSend")}: {s.autoSendEnabled ? t("on") : t("off")}
          </button>
        </div>
      </section>

      <section className={CARD_MAIN}>
        <h2 className="text-base font-bold text-[#1A1F36]">{t("channelUrlTitle")}</h2>
        <p id="outreach-channel-url-help" className="mt-1 text-xs text-[#1A1F36]/60">
          {t("channelUrlHelp")}
        </p>
        <label className={`${LABEL} mt-4`} htmlFor="outreach-channel-url">
          {t("channelUrlLabel")}
        </label>
        <input
          id="outreach-channel-url"
          type="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          dir="ltr"
          maxLength={500}
          value={draft.channelUrl ?? s.channelUrl ?? ""}
          onChange={(event) => {
            setDraft((current) => ({ ...current, channelUrl: event.target.value }));
            setChannelUrlSaveState(null);
          }}
          disabled={savingChannelUrl || !settings?.settings}
          aria-describedby="outreach-channel-url-help"
          aria-invalid={channelUrlSaveState?.kind === "err"}
          className={INPUT}
        />
        <button
          type="button"
          onClick={() => void saveChannelUrl()}
          disabled={savingChannelUrl || !settings?.settings}
          className={BTN_PRIMARY + " mt-3 w-full"}
        >
          {savingChannelUrl && <Loader2 className="h-4 w-4 animate-spin" />}
          {savingChannelUrl ? t("saving") : t("saveChannelUrl")}
        </button>
        {channelUrlSaveState && (
          <p
            role={channelUrlSaveState.kind === "err" ? "alert" : "status"}
            className={
              "mt-3 rounded-2xl p-3 text-sm font-bold text-white " +
              (channelUrlSaveState.kind === "ok" ? "bg-[#34C759]" : "bg-[#FF4D5E]")
            }
          >
            {channelUrlSaveState.text}
          </p>
        )}
      </section>

      <section className={CARD_MAIN}>
        <h2 className="text-base font-bold text-[#1A1F36]">{t("seedTitle")}</h2>
        <p className="mt-1 text-xs text-[#1A1F36]/60">{t("seedHelp")}</p>
        <textarea
          value={seedText}
          onChange={(e) => setSeedText(e.target.value)}
          className={INPUT + " mt-3 min-h-32 font-mono text-xs"}
          placeholder={"Mehdi Barber | https://instagram.com/mehdi_barber | Tehran"}
          dir="ltr"
        />
        <button type="button" onClick={saveSeed} className={BTN_PRIMARY + " mt-3 w-full"}>
          <Settings2 className="h-4 w-4" />
          {t("saveSeed")}
        </button>
      </section>

      <section className={CARD_MAIN}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-[#1A1F36]">{t("candidatesTitle")}</h2>
          {selected.length > 0 && (
            <button type="button" onClick={promote} className={BTN_PRIMARY}>
              <CheckCircle2 className="h-4 w-4" />
              {t("promote")} ({selected.length})
            </button>
          )}
        </div>

        <div className="mt-3 space-y-2">
          {candidates.length === 0 && (
            <p className="text-sm text-[#1A1F36]/60">{t("noCandidates")}</p>
          )}

          {candidates.map((candidate: any) => (
            <div key={candidate.id} className={CARD_INNER}>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.includes(candidate.id)}
                  onChange={(e) =>
                    setSelected((current) =>
                      e.target.checked
                        ? [...current, candidate.id]
                        : current.filter((id) => id !== candidate.id)
                    )
                  }
                  className="mt-1 h-4 w-4 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-[#1A1F36]">
                    {candidate.publicName}
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-[#1A1F36]/60">
                    {candidate.group} · {t("score")} {candidate.score} ·{" "}
                    {formatDate(candidate.discoveredOn)} · {candidate.source}
                  </p>
                  {candidate.matchedTerms && (
                    <p className="mt-1 text-[11px] font-medium text-[#4F5FE8]">
                      {candidate.matchedTerms}
                    </p>
                  )}
                  {candidate.publicUrl && (
                    <a
                      href={candidate.publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block truncate text-[11px] font-bold text-[#4F5FE8]"
                      dir="ltr"
                    >
                      {candidate.publicUrl}
                    </a>
                  )}
                </div>
                <span className={`${BADGE} ${statusColor(candidate.status)}`}>
                  {candidate.status}
                </span>
              </label>

              {candidate.status === "NEW" && (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void review(candidate.id, "SHORTLISTED")}
                    className="rounded-xl bg-[#34C759] px-3 py-2 text-xs font-bold text-white shadow-soft"
                  >
                    {t("shortlist")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void review(candidate.id, "REJECTED")}
                    className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#FF4D5E] shadow-soft"
                  >
                    {t("reject")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className={CARD_MAIN}>
        <h2 className="text-base font-bold text-[#1A1F36]">{t("runsTitle")}</h2>
        <div className="mt-3 space-y-2">
          {runs.length === 0 && <p className="text-sm text-[#1A1F36]/60">{t("noRuns")}</p>}
          {runs.map((runRow: any) => (
            <div key={runRow.id} className={CARD_INNER}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-[#1A1F36]" dir="ltr">
                  {runRow.runDate}
                </span>
                <span className={`${BADGE} ${statusColor(runRow.status)}`}>
                  {runRow.status}
                </span>
              </div>
              <p className="mt-1 text-[11px] font-medium text-[#1A1F36]/60" dir="ltr">
                +{runRow.discovered} · dup {runRow.duplicates} · excl{" "}
                {runRow.excluded} · prep {runRow.invitationsPrepared} · sent{" "}
                {runRow.messagesDelivered}
              </p>
              {runRow.error && (
                <p className="mt-1 text-[11px] font-bold text-[#FF4D5E]">{runRow.error}</p>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Telegram bot setup                                                      */
/* ---------------------------------------------------------------------- */

function BotTab({ info, run, refresh, setMessage }: any) {
  const t = useTranslations("outreach");

  async function configure() {
    await run(async () => {
      await api("/api/admin/telegram/webhook", { method: "POST" });
      await refresh();
      setMessage({ kind: "ok", text: t("botConfigured") });
    });
  }

  return (
    <div className="space-y-4">
      <section className={CARD_MAIN}>
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft">
            <Bot className="h-5 w-5 text-[#4F5FE8]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-[#1A1F36]">{t("botTitle")}</h2>
            <p className="mt-1 text-xs text-[#1A1F36]/60">{t("botHelp")}</p>
          </div>
        </div>

        <button type="button" onClick={configure} className={BTN_PRIMARY + " mt-4 w-full"}>
          <KeyRound className="h-4 w-4" />
          {t("configureBot")}
        </button>

        <button
          type="button"
          onClick={() => void refresh()}
          className={BTN_GHOST + " mt-2 w-full"}
        >
          <RefreshCw className="h-4 w-4" />
          {t("refreshStatus")}
        </button>
      </section>

      {info && (
        <section className={CARD_MAIN}>
          <h2 className="text-base font-bold text-[#1A1F36]">{t("botStatus")}</h2>
          <pre
            className="mt-3 overflow-x-auto rounded-2xl bg-white p-4 text-[11px] font-medium leading-6 text-[#1A1F36] shadow-soft"
            dir="ltr"
          >
            {JSON.stringify(info, null, 2)}
          </pre>
        </section>
      )}

      <section className={CARD_MAIN}>
        <h2 className="text-base font-bold text-[#1A1F36]">{t("botManualTitle")}</h2>
        <ol className="mt-3 space-y-2 text-xs font-medium leading-6 text-[#1A1F36]/80">
          <li>1. {t("botStep1")}</li>
          <li>2. {t("botStep2")}</li>
          <li>3. {t("botStep3")}</li>
        </ol>
        <p className="mt-3 rounded-2xl bg-white p-3 text-[11px] font-medium leading-6 text-[#1A1F36]/70 shadow-soft">
          {t("botNote")}
        </p>
        <a
          href="https://t.me/Bookora_App_bot"
          target="_blank"
          rel="noopener noreferrer"
          className={BTN_GHOST + " mt-3 w-full"}
        >
          <Send className="h-4 w-4" />
          {t("openBot")}
        </a>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Campaigns — configurable-market targeting, message builder, dry-run + approval */
/* -------------------------------------------------------------------------- */

const CAMPAIGN_STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-[#1A1F36]/10 text-[#1A1F36]/70",
  REVIEW: "bg-[#FF9F0A]/15 text-[#B45309]",
  APPROVED: "bg-[#4F5FE8]/15 text-[#4F5FE8]",
  SENDING: "bg-[#FF9F0A]/15 text-[#B45309]",
  COMPLETED: "bg-[#34C759]/15 text-[#248A3D]",
  FAILED: "bg-[#FF4D5E]/15 text-[#C0263A]",
};

/**
 * Searchable multi-select over the *approved* market registry.
 * - Never renders a hardcoded city list.
 * - Shows the selected count and the per-campaign ceiling.
 * - Only approved cities are selectable; everything else lives in Markets.
 */
function CityPicker({
  registry,
  selected,
  max,
  onChange,
}: {
  registry: CityEntry[];
  selected: string[];
  max: number;
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations("outreach");
  const locale = useLocale();
  const [query, setQuery] = useState("");

  const approved = registry.filter((entry) => entry.approved);
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? approved.filter(
        (entry) =>
          entry.code.toLowerCase().includes(needle) ||
          entry.fa.includes(query.trim()) ||
          (entry.en ?? "").toLowerCase().includes(needle)
      )
    : approved;

  function toggle(code: string) {
    if (selected.includes(code)) {
      onChange(selected.filter((item) => item !== code));
      return;
    }
    if (selected.length >= max) return;
    onChange([...selected, code]);
  }

  return (
    <div>
      <label className={LABEL} htmlFor="city-search">
        {t("cities")} ·{" "}
        <span className={selected.length >= max ? "text-[#B45309]" : ""}>
          {t("citiesSelected", { count: selected.length, max })}
        </span>
      </label>
      <div className="relative mt-1">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#1A1F36]/40" />
        <input
          id="city-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={INPUT + " ps-9"}
          placeholder={t("citiesSearchPlaceholder")}
          inputMode="search"
        />
      </div>
      <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto" role="group" aria-label={t("cities")}>
        {visible.map((entry) => {
          const active = selected.includes(entry.code);
          const disabled = !active && selected.length >= max;
          return (
            <button
              key={entry.code}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => toggle(entry.code)}
              className={`rounded-xl px-3 py-2 text-xs font-bold transition-transform active:scale-95 ${
                active
                  ? "bg-[#4F5FE8] text-white"
                  : disabled
                    ? "bg-[#1A1F36]/5 text-[#1A1F36]/30"
                    : "bg-[#1A1F36]/5 text-[#1A1F36]/70"
              }`}
            >
              {cityDisplayName(entry, locale)}
            </button>
          );
        })}
        {visible.length === 0 && (
          <p className="text-[11px] font-medium text-[#1A1F36]/50">
            {needle ? t("noCitiesMatch") : t("noApprovedCities")}
          </p>
        )}
      </div>
      <p className="mt-1 text-[11px] font-medium text-[#1A1F36]/50">{t("citiesHelp")}</p>
    </div>
  );
}

/**
 * Market registry management. Every entry the deployment knows, with its
 * approval state. New cities ship DISABLED: outreach never auto-expands into
 * them; an explicit admin tap approves or withdraws one market at a time.
 */
function MarketsCard({ registry, onSaved }: { registry: CityEntry[]; onSaved: () => Promise<void> | void }) {
  const t = useTranslations("outreach");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? registry.filter(
        (entry) =>
          entry.code.toLowerCase().includes(needle) ||
          entry.fa.includes(query.trim()) ||
          (entry.en ?? "").toLowerCase().includes(needle) ||
          (entry.region ?? "").toLowerCase().includes(needle)
      )
    : registry;
  const approvedCount = registry.filter((entry) => entry.approved).length;

  async function approve(code: string, approved: boolean) {
    setBusyCode(code);
    try {
      await api("/api/admin/outreach/markets", {
        method: "PUT",
        body: JSON.stringify({ code, approved }),
      });
      await onSaved();
    } finally {
      setBusyCode(null);
    }
  }

  return (
    <div className={`${CARD_MAIN} mt-3`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold text-[#1A1F36]">{t("marketsTitle")}</h3>
          <p className="mt-1 text-[11px] font-medium text-[#1A1F36]/60">{t("marketsHelp")}</p>
        </div>
        <span className={BADGE + " bg-white text-[#1A1F36]/70"}>
          {t("marketsCount", { count: approvedCount, max: registry.length })}
        </span>
      </div>

      <div className="relative mt-3">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#1A1F36]/40" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={INPUT + " ps-9"}
          placeholder={t("marketsSearchPlaceholder")}
          inputMode="search"
          aria-label={t("marketsTitle")}
        />
      </div>

      <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pe-1">
        {visible.map((entry) => (
          <div key={entry.code} className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 shadow-soft">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-[#1A1F36]">
                {cityDisplayName(entry, locale)}
                <span className="ms-2 text-[10px] font-medium text-[#1A1F36]/40" dir="ltr">
                  {entry.code}
                  {entry.region ? ` · ${entry.region}` : ""}
                </span>
              </p>
            </div>
            <button
              type="button"
              disabled={busyCode === entry.code}
              onClick={() => void approve(entry.code, !entry.approved)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-bold text-white shadow-soft disabled:opacity-50 ${
                entry.approved ? "bg-[#34C759]" : "bg-[#1A1F36]/30"
              }`}
            >
              {entry.approved ? t("cityApproved") : t("cityApprove")}
            </button>
          </div>
        ))}
        {visible.length === 0 && (
          <p className="py-2 text-center text-[11px] font-medium text-[#1A1F36]/50">{t("noCitiesMatch")}</p>
        )}
      </div>
      <p className="mt-2 text-[10px] font-medium text-[#1A1F36]/45">{t("marketsSafety")}</p>
    </div>
  );
}

function MessageBuilder({
  campaign,
  registry,
  messageDefaults,
  onSaved,
}: {
  campaign: any;
  registry: CityEntry[];
  messageDefaults: any;
  onSaved: () => Promise<void> | void;
}) {
  const t = useTranslations("outreach");
  const locale = useLocale();
  const [form, setForm] = useState({
    message: campaign.templateBody ?? "",
    language: campaign.language ?? "fa",
    cta: campaign.cta ?? "",
    destinationUrl: campaign.destinationUrl ?? "",
    bot: true,
    channel: false,
    other: false,
    busy: false,
    saved: false,
    error: null as string[] | null,
  });

  const channelUrl: string = messageDefaults?.channelUrl ?? "";
  const botUrl: string = messageDefaults?.botUrl ?? "";
  const locked = campaign.status !== "DRAFT" && campaign.status !== "REVIEW";

  const composed = composeCampaignMessage({
    message: form.message,
    cta: form.cta || null,
    destinations: { bot: form.bot, channel: form.channel, other: form.other },
    channelUrl,
    otherUrl: form.destinationUrl || null,
  });
  const preview = previewCampaignMessage(
    {
      message: form.message,
      cta: form.cta || null,
      destinations: { bot: form.bot, channel: form.channel, other: form.other },
      channelUrl,
      otherUrl: form.destinationUrl || null,
    },
    {
      businessName: t("sampleBusinessName"),
      sampleLink: botUrl || "{link}",
      categoryLabel: t("sampleCategory"),
    }
  );
  const dir = messageDirection(form.language);

  async function save() {
    if (composed.errors.length > 0) {
      setForm((current) => ({ ...current, error: composed.errors }));
      return;
    }
    setForm((current) => ({ ...current, busy: true, error: null }));
    try {
      await api(`/api/admin/outreach/campaigns/${campaign.id}/message`, {
        method: "PATCH",
        body: JSON.stringify({
          message: form.message,
          language: form.language,
          cta: form.cta || null,
          destinationUrl: form.destinationUrl || null,
          destinations: { bot: form.bot, channel: form.channel, other: form.other },
        }),
      });
      setForm((current) => ({ ...current, busy: false, saved: true }));
      await onSaved();
    } catch (error) {
      setForm((current) => ({
        ...current,
        busy: false,
        error: [error instanceof Error ? error.message : "save failed"],
      }));
    }
  }

  return (
    <div className="mt-3 rounded-2xl bg-[#B8D4F5]/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-extrabold text-[#1A1F36]">{t("messageBuilderTitle")}</h4>
        {locked && (
          <span className={BADGE + " bg-[#FF9F0A]/20 text-[#B45309]"}>{t("messageLocked")}</span>
        )}
      </div>
      <p className="mt-1 text-[11px] font-medium text-[#1A1F36]/60">{t("messageBuilderHelp")}</p>

      <div className="mt-3 space-y-3">
        <div>
          <label className={LABEL} htmlFor={`msg-${campaign.id}`}>
            {t("messageText")}
          </label>
          <textarea
            id={`msg-${campaign.id}`}
            value={form.message}
            disabled={locked}
            onChange={(e) => setForm({ ...form, message: e.target.value, saved: false })}
            dir={dir}
            className={INPUT + " min-h-44 text-sm leading-7"}
            placeholder={t("messageTextPlaceholder")}
          />
          <p className="mt-1 text-[10px] font-medium text-[#1A1F36]/50" dir="ltr">
            {"{businessName} · {link} · {category}"} ·{" "}
            {t("charactersCount", { count: composed.body.length, max: 1500 })}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={LABEL} htmlFor={`cta-${campaign.id}`}>
              {t("ctaLabel")}
            </label>
            <input
              id={`cta-${campaign.id}`}
              value={form.cta}
              disabled={locked}
              dir={dir}
              onChange={(e) => setForm({ ...form, cta: e.target.value, saved: false })}
              className={INPUT}
              placeholder={t("ctaPlaceholder")}
            />
          </div>
          <div>
            <label className={LABEL}>{t("language")}</label>
            <select
              value={form.language}
              disabled={locked}
              onChange={(e) => setForm({ ...form, language: e.target.value, saved: false })}
              className={INPUT}
            >
              {LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className="rounded-2xl bg-white p-3 shadow-soft">
          <legend className={LABEL}>{t("destinationsTitle")}</legend>
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-xs font-bold text-[#1A1F36]">
              <input
                type="checkbox"
                checked={form.bot}
                disabled={locked}
                onChange={(e) => setForm({ ...form, bot: e.target.checked, saved: false })}
                className="mt-0.5 h-4 w-4"
              />
              <span dir="ltr" className="break-all">
                {t("destBot")}{" "}
                <span className="font-medium text-[#1A1F36]/50">
                  {botUrl ? `→ ${botUrl}` : ""}
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-xs font-bold text-[#1A1F36]">
              <input
                type="checkbox"
                checked={form.channel}
                disabled={locked || channelUrl.length === 0}
                onChange={(e) => setForm({ ...form, channel: e.target.checked, saved: false })}
                className="mt-0.5 h-4 w-4"
              />
              <span dir="ltr" className="break-all">
                {t("destChannel")}{" "}
                {channelUrl ? (
                  <span className="font-medium text-[#1A1F36]/50">→ {channelUrl}</span>
                ) : (
                  <span className="font-medium text-[#B45309]">{t("channelUrlMissing")}</span>
                )}
              </span>
            </label>

            <label className="flex items-start gap-2 text-xs font-bold text-[#1A1F36]">
              <input
                type="checkbox"
                checked={form.other}
                disabled={locked}
                onChange={(e) => setForm({ ...form, other: e.target.checked, saved: false })}
                className="mt-0.5 h-4 w-4"
              />
              <span className="break-all">{t("destOther")}</span>
            </label>
            {form.other && (
              <input
                value={form.destinationUrl}
                disabled={locked}
                onChange={(e) => setForm({ ...form, destinationUrl: e.target.value, saved: false })}
                className={INPUT}
                dir="ltr"
                inputMode="url"
                placeholder="https://… / https://wa.me/…"
                aria-label={t("destOther")}
              />
            )}
          </div>
        </fieldset>

        <section className="rounded-2xl bg-white p-3 shadow-soft" aria-live="polite">
          <h5 className="text-[11px] font-extrabold uppercase tracking-wide text-[#1A1F36]/60">
            {t("previewFinal")}
          </h5>
          <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-7 text-[#1A1F36]" dir={dir}>
            {preview.body}
          </p>
          {composed.links.length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-[#1A1F36]/10 pt-2">
              {composed.links.map((link) => (
                <li key={link.kind + link.value} className="break-all text-[11px] font-bold text-[#4F5FE8]" dir="ltr">
                  {link.kind === "bot" ? t("destBotUrl") : link.value}
                </li>
              ))}
            </ul>
          )}
          {composed.errors.length > 0 && (
            <ul className="mt-2 space-y-1">
              {composed.errors.map((code) => (
                <li key={code} className="text-[11px] font-bold text-[#C0263A]">
                  ⚠️ {describeComposeError(code)}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10px] font-medium text-[#1A1F36]/45">{t("previewNote")}</p>
        </section>

        <button
          type="button"
          className={BTN_PRIMARY + " w-full"}
          disabled={locked || form.busy || composed.errors.length > 0}
          onClick={() => void save()}
        >
          {form.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : form.saved ? <Check className="h-4 w-4" /> : null}
          {form.saved && !form.busy ? t("messageSaved") : t("saveMessage")}
        </button>
        {form.error && (
          <p className="text-[11px] font-bold text-[#C0263A]">{form.error.join(" · ")}</p>
        )}
      </div>
    </div>
  );
}

function CampaignsTab({
  campaigns,
  templates,
  cityData,
  run,
  refresh,
  setMessage,
}: any) {
  const t = useTranslations("outreach");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [campaignDetails, setCampaignDetails] = useState<Record<string, any>>({});
  const [showMarkets, setShowMarkets] = useState(false);
  const registry: CityEntry[] = cityRegistryOf(cityData);
  const maxCities = cityData?.maxCampaignCities ?? 100;
  const messageDefaults = cityData?.messageDefaults ?? null;
  const [form, setForm] = useState({
    name: "",
    cities: [] as string[],
    segments: [] as string[],
    language: "fa",
    templateId: "",
    sendLimit: "" as string,
    objective: "",
  });

  function toggle(list: string[], value: string) {
    return list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value];
  }

  async function create() {
    await run(async () => {
      await api("/api/admin/outreach/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          cities: form.cities,
          segments: form.segments,
          language: form.language,
          templateId: form.templateId || null,
          objective: form.objective || null,
          sendLimit: form.sendLimit ? Number(form.sendLimit) : null,
        }),
      });
      setOpen(false);
      setForm({
        name: "",
        cities: [],
        segments: [],
        language: "fa",
        templateId: "",
        sendLimit: "",
        objective: "",
      });
      await refresh();
      setMessage({ kind: "ok", text: t("campaignCreated") });
    });
  }

  async function act(id: string, action: string) {
    await run(async () => {
      const data = await api<any>(
        `/api/admin/outreach/campaigns/${id}/${action}`,
        { method: "POST" }
      );
      if (data.plan) setPlan({ ...data.plan, campaignId: id });
      await refresh();
      setMessage({
        kind: "ok",
        text:
          action === "dry-run"
            ? t("dryRunDone")
            : action === "approve"
              ? t("campaignApproved")
              : action === "prepare"
                ? `${t("preparedCount")}: ${data.prepared ?? 0}`
                : action === "approve-invitations"
                  ? `${t("approvedInvitations")}: ${data.approved ?? 0}`
                  : `${t("sent")}: ${data.sent ?? 0} · ${t("delivered")}: ${
                      data.delivered ?? 0
                    }`,
      });
    });
  }

  async function loadPlan(id: string) {
    await run(async () => {
      const data = await api<any>(`/api/admin/outreach/campaigns/${id}`);
      setCampaignDetails((current) => ({ ...current, [id]: data.campaign }));
      setPlan({ ...data.plan, campaignId: id });
      setExpanded(id);
    });
  }

  async function openEditor(id: string) {
    if (editing === id) {
      setEditing(null);
      return;
    }
    await run(async () => {
      const data = await api<any>(`/api/admin/outreach/campaigns/${id}`);
      setCampaignDetails((current) => ({ ...current, [id]: data.campaign }));
      setEditing(id);
    });
  }

  return (
    <div className={CARD_MAIN}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold text-[#1A1F36]">
            {t("campaignsTitle")}
          </h2>
          <p className="mt-1 text-xs font-medium text-[#1A1F36]/60">
            {t("campaignsHelp")}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button className={BTN_NEUTRAL} onClick={() => setShowMarkets((v) => !v)}>
            <Settings2 className="h-3.5 w-3.5" />
            {t("marketsTitle")}
          </button>
          <button className={BTN_PRIMARY} onClick={() => setOpen((v) => !v)}>
            {t("newCampaign")}
          </button>
        </div>
      </div>

      {showMarkets && (
        <MarketsCard registry={registry} onSaved={refresh} />
      )}

      {open && (
        <div className={`${CARD_INNER} mt-3 space-y-3`}>
          <div>
            <label className={LABEL}>{t("campaignName")}</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={INPUT}
              placeholder={t("campaignNamePlaceholder")}
            />
          </div>

          <div>
            <label className={LABEL}>{t("objective")}</label>
            <input
              value={form.objective}
              onChange={(e) => setForm({ ...form, objective: e.target.value })}
              dir={messageDirection(form.language)}
              className={INPUT}
              placeholder={t("objectivePlaceholder")}
            />
          </div>

          <CityPicker
            registry={registry}
            max={maxCities}
            selected={form.cities}
            onChange={(cities) => setForm({ ...form, cities })}
          />

          <div>
            <label className={LABEL}>{t("segments")}</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {SEGMENT_OPTIONS.map((segment) => {
                const active = form.segments.includes(segment);
                return (
                  <button
                    key={segment}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setForm({
                        ...form,
                        segments: toggle(form.segments, segment),
                      })
                    }
                    className={`rounded-xl px-3 py-2 text-xs font-bold ${
                      active
                        ? "bg-[#4F5FE8] text-white"
                        : "bg-[#1A1F36]/5 text-[#1A1F36]/70"
                    }`}
                  >
                    {SEGMENT_FA[segment]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={LABEL}>{t("language")}</label>
              <select
                value={form.language}
                onChange={(e) =>
                  setForm({ ...form, language: e.target.value })
                }
                className={INPUT}
              >
                {LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>{t("template")}</label>
              <select
                value={form.templateId}
                onChange={(e) =>
                  setForm({ ...form, templateId: e.target.value })
                }
                className={INPUT}
              >
                <option value="">{t("templateAuto")}</option>
                {templates.map((template: any) => (
                  <option key={template.id} value={template.id}>
                    {template.code} · {template.language}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>{t("sendLimit")}</label>
              <input
                value={form.sendLimit}
                onChange={(e) =>
                  setForm({ ...form, sendLimit: e.target.value })
                }
                className={INPUT}
                placeholder="10"
                inputMode="numeric"
                dir="ltr"
              />
            </div>
          </div>

          <button
            className={BTN_PRIMARY}
            disabled={form.name.trim().length === 0}
            onClick={create}
          >
            {t("createCampaign")}
          </button>
        </div>
      )}

      <div className="mt-3 space-y-3">
        {campaigns.length === 0 && (
          <p className={`${CARD_INNER} text-sm text-[#1A1F36]/60`}>
            {t("noCampaigns")}
          </p>
        )}

        {campaigns.map((campaign: any) => (
          <div key={campaign.id} className={CARD_INNER}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#1A1F36]">
                  {campaign.name}
                </p>
                <p className="mt-0.5 text-[11px] font-medium text-[#1A1F36]/60">
                  {campaign.cities.length > 0
                    ? `${campaign.cities.length} · ${campaign.cities
                        .slice(0, 4)
                        .map((c: string) => cityLabelFor(c, registry, locale))
                        .join("، ")}` + (campaign.cities.length > 4 ? " …" : "")
                    : t("allCities")}
                  {" · "}
                  {campaign.segments.length > 0
                    ? campaign.segments
                        .map((s: string) => SEGMENT_FA[s] ?? s)
                        .join("، ")
                    : t("allSegments")}
                </p>
              </div>
              <span
                className={`${BADGE} ${
                  CAMPAIGN_STATUS_COLORS[campaign.status] ?? ""
                }`}
              >
                {campaign.status}
              </span>
            </div>

            <p className="mt-2 text-[11px] font-medium text-[#1A1F36]/50" dir="ltr">
              {campaign.deepLink}
            </p>

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className={BTN_NEUTRAL}
                onClick={() => void run(() => openEditor(campaign.id))}
              >
                <Mail className="h-3.5 w-3.5" />
                {t("editMessage")}
              </button>
              <button
                className={BTN_NEUTRAL}
                onClick={() => void run(() => act(campaign.id, "dry-run"))}
              >
                {t("dryRun")}
              </button>
              <button
                className={BTN_PRIMARY}
                onClick={() => void run(() => act(campaign.id, "approve"))}
                disabled={campaign.status === "APPROVED"}
              >
                {t("approve")}
              </button>
              <button
                className={BTN_NEUTRAL}
                onClick={() => void run(() => act(campaign.id, "prepare"))}
                disabled={campaign.status !== "APPROVED"}
              >
                {t("prepare")}
              </button>
              <button
                className={BTN_NEUTRAL}
                onClick={() => void run(() => loadPlan(campaign.id))}
              >
                {t("viewPlan")}
              </button>
            </div>

            {editing === campaign.id && campaignDetails[campaign.id] && (
              <MessageBuilder
                campaign={campaignDetails[campaign.id]}
                registry={registry}
                messageDefaults={messageDefaults}
                onSaved={async () => {
                  await refresh();
                  const data = await api<any>(`/api/admin/outreach/campaigns/${campaign.id}`);
                  setCampaignDetails((current: any) => ({ ...current, [campaign.id]: data.campaign }));
                  setMessage({ kind: "ok", text: t("messageSaved") });
                }}
              />
            )}

            {expanded === campaign.id && plan && plan.campaignId === campaign.id && (
              <div className="mt-3 rounded-xl bg-[#B8D4F5]/30 p-3">
                <p className="text-xs font-bold text-[#1A1F36]">
                  {t("eligible")}: {plan.eligible} · {t("manualOnly")}:{" "}
                  {plan.manualOnly} · {t("blocked")}: {plan.blocked}
                </p>

                {plan.byCitySegment?.length > 0 && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-[#1A1F36]/60">
                          <th className="py-1 text-start">{t("city")}</th>
                          <th className="py-1 text-start">{t("segment")}</th>
                          <th className="py-1 text-end">{t("eligible")}</th>
                          <th className="py-1 text-end">{t("manualOnly")}</th>
                          <th className="py-1 text-end">{t("blocked")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.byCitySegment.map((cell: any, index: number) => (
                          <tr key={index} className="font-bold text-[#1A1F36]">
                            <td className="py-1">
                              {cell.city === "UNASSIGNED"
                                ? t("cityUnassigned")
                                : cityLabelFor(cell.city, registry, locale)}
                            </td>
                            <td className="py-1">
                              {cell.segment === "UNASSIGNED"
                                ? "—"
                                : SEGMENT_FA[cell.segment] ?? cell.segment}
                            </td>
                            <td className="py-1 text-end">{cell.eligible}</td>
                            <td className="py-1 text-end">{cell.manualOnly}</td>
                            <td className="py-1 text-end">{cell.blocked}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {plan.warnings?.map((warning: string, index: number) => (
                  <p
                    key={index}
                    className="mt-2 text-[11px] font-bold text-[#B45309]"
                  >
                    ⚠️ {warning}
                  </p>
                ))}

                {plan.recipients?.slice(0, 3).map((recipient: any) => (
                  <div
                    key={recipient.prospectId}
                    className="mt-2 rounded-lg bg-white p-2"
                  >
                    <p className="text-[11px] font-bold text-[#1A1F36]">
                      {recipient.publicName} ·{" "}
                      {recipient.disposition === "ELIGIBLE"
                        ? t("eligible")
                        : t("manualOnly")}
                    </p>
                    {recipient.previewBody && (
                      <pre className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-[#1A1F36]/80">
                        {recipient.previewBody}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
