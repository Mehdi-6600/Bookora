"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
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

type Tab = "overview" | "prospects" | "invitations" | "templates" | "keywords" | "discovery" | "bot";

const TABS: Tab[] = [
  "overview",
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
  const [prospects, setProspects] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [keywords, setKeywords] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [botInfo, setBotInfo] = useState<any>(null);

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
  }, []);

  const loadBot = useCallback(async () => {
    setBotInfo(await api("/api/admin/telegram/webhook"));
  }, []);

  useEffect(() => {
    void loadStats().catch(() => undefined);
  }, [loadStats]);

  useEffect(() => {
    if (tab === "prospects") void loadProspects().catch(() => undefined);
    if (tab === "invitations") void loadInvitations().catch(() => undefined);
    if (tab === "templates") void loadTemplates().catch(() => undefined);
    if (tab === "keywords") void loadKeywords().catch(() => undefined);
    if (tab === "discovery") {
      void loadDiscovery().catch(() => undefined);
      void loadSettings().catch(() => undefined);
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

      {tab === "prospects" && (
        <ProspectsTab
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
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    publicName: "",
    category: "BARBER",
    city: "",
    language: "en",
    publicUrl: "",
    telegramUsername: "",
    sourceUrl: "",
    notes: "",
  });

  async function create() {
    await run(async () => {
      await api("/api/admin/outreach/prospects", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          city: form.city || null,
          publicUrl: form.publicUrl || null,
          telegramUsername: form.telegramUsername || null,
          sourceUrl: form.sourceUrl || null,
          notes: form.notes || null,
        }),
      });
      setOpen(false);
      setForm({
        publicName: "",
        category: "BARBER",
        city: "",
        language: "en",
        publicUrl: "",
        telegramUsername: "",
        sourceUrl: "",
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
                <input
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className={INPUT}
                />
              </div>
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
                    {prospect.category}
                    {prospect.city ? ` · ${prospect.city}` : ""}
                    {prospect.language ? ` · ${prospect.language}` : ""}
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
