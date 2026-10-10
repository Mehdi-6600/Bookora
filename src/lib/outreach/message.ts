/**
 * Campaign message builder — pure, DB-free logic shared by the admin UI
 * preview and the server-side save path.
 *
 * The invariant this module exists for: the message an administrator PREVIEWED
 * is byte-for-byte the message PREPARED for a recipient, apart from the
 * per-recipient `{link}` value (each invitation carries its own Telegram
 * `start` parameter so attribution stays possible). Both the preview and the
 * preparation pipeline run through `composeCampaignMessage` + `renderTemplate`
 * here, so they cannot drift apart.
 *
 * Safety rules encoded below:
 *  - Only http(s) URLs are accepted. `javascript:`, `data:`, `vbscript:`,
 *    `file:` and friends are rejected outright.
 *  - Links are NEVER auto-inserted. A destination contributes to the message
 *    only when the administrator selected it and provided a real URL.
 *  - The Bookora channel URL comes from settings and has no default: if the
 *    owner has not supplied the public channel link, selecting "channel" is a
 *    validation error, not a guess.
 *  - Unknown `{placeholder}` tokens are rejected (rather than silently
 *    stripped) so the preview cannot hide a typo from the reviewer.
 */

import { renderTemplate } from "@/lib/outreach/templates";

/** Same ceiling the invitation_templates body column is validated with. */
export const MESSAGE_MAX_LENGTH = 1500;
export const CTA_MAX_LENGTH = 120;
export const MESSAGE_URL_MAX_LENGTH = 500;

export const ALLOWED_PLACEHOLDERS = ["businessName", "link", "category"] as const;
export type AllowedPlaceholder = (typeof ALLOWED_PLACEHOLDERS)[number];

export type DestinationKey = "bot" | "channel" | "other";

export type DestinationSelection = {
  bot: boolean;
  channel: boolean;
  other: boolean;
};

/** Anything that can execute or smuggle instead of navigating. */
const DANGEROUS_SCHEME =
  /^(?:javascript|data|vbscript|file|blob|about|view-source|chrome|resource):/i;

export type SafeUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: "empty" | "invalid" | "scheme" | "tooLong" };

/**
 * Validate a destination URL. Accepts absolute http(s) URLs only, strips
 * control characters, and normalises the URL so look-alikes
 * ("http://a.com\u0000evil") cannot survive into the stored message.
 */
export function validateDestinationUrl(raw: unknown): SafeUrlResult {
  if (typeof raw !== "string") return { ok: false, reason: "invalid" };
  const trimmed = raw
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f]/g, "")
    .trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if (trimmed.length > MESSAGE_URL_MAX_LENGTH) return { ok: false, reason: "tooLong" };
  if (DANGEROUS_SCHEME.test(trimmed)) return { ok: false, reason: "scheme" };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "scheme" };
  }
  if (!parsed.hostname) return { ok: false, reason: "invalid" };
  return { ok: true, url: parsed.toString() };
}

/** Find `{tokens}` in the text that the renderer does not know. */
export function findUnknownPlaceholders(text: string): string[] {
  const found = text.match(/\{\s*[A-Za-z][A-Za-z0-9_]*\s*\}/g) ?? [];
  const allowed = new Set(ALLOWED_PLACEHOLDERS.map((name) => `{${name}}`));
  const unique: string[] = [];
  for (const token of found) {
    const normalized = `{${token.slice(1, -1).trim()}}`;
    if (allowed.has(normalized)) continue;
    if (!unique.includes(normalized)) unique.push(normalized);
  }
  return unique;
}

export type ComposeInput = {
  /** Admin-editable invitation text; may contain allowed placeholders. */
  message: string;
  /** Optional call-to-action line (campaign.cta). */
  cta?: string | null;
  /** Which destinations the administrator selected for this campaign. */
  destinations: Partial<DestinationSelection> | null | undefined;
  /** Public Bookora channel URL from settings. No fallback, ever. */
  channelUrl?: string | null;
  /** Campaign destination URL (site, wa.me contact, …). */
  otherUrl?: string | null;
};

export type ComposedLink = {
  kind: DestinationKey;
  /** The literal token or absolute URL that ends up in the final message. */
  value: string;
};

export type ComposedMessage = {
  /** Body to store on the campaign's invitation template. */
  body: string;
  /** Every destination that WILL appear, including ones already inline. */
  links: ComposedLink[];
  /** Machine-readable validation codes; an empty array means "safe to save". */
  errors: string[];
  /** The lines this composer appended (preview of what "links" adds). */
  appended: ComposedLink[];
};

function normalizeSelection(
  destinations: ComposeInput["destinations"]
): DestinationSelection {
  return {
    bot: Boolean(destinations?.bot),
    channel: Boolean(destinations?.channel),
    other: Boolean(destinations?.other),
  };
}

/**
 * Compose the final campaign message from the editable parts.
 *
 * Returns both the body and the error list; the caller (UI or API) must treat
 * a non-empty `errors` as "do not save / do not preview as final".
 */
export function composeCampaignMessage(input: ComposeInput): ComposedMessage {
  const errors: string[] = [];
  const text = (input.message ?? "").replace(/\r\n?/g, "\n").trim();
  const cta =
    typeof input.cta === "string"
      ? input.cta.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, CTA_MAX_LENGTH)
      : "";
  const { bot, channel, other } = normalizeSelection(input.destinations);

  if (!bot && !channel && !other) errors.push("destinations.none");
  if (text.length === 0) errors.push("message.empty");

  for (const token of findUnknownPlaceholders(text)) {
    errors.push(`placeholder.unknown:${token}`);
  }

  // {link} is the per-recipient bot deep link. A message carrying it while
  // the bot destination is switched off would prepare something different
  // from what was previewed — so that is an error, not a silent decision.
  if (text.includes("{link}") && !bot) errors.push("placeholder.linkWithoutBot");

  let channelTarget: string | null = null;
  if (channel) {
    const raw = typeof input.channelUrl === "string" ? input.channelUrl.trim() : "";
    if (raw.length === 0) {
      errors.push("channelUrl.notConfigured");
    } else {
      const valid = validateDestinationUrl(raw);
      if (valid.ok) channelTarget = valid.url;
      else errors.push(`channelUrl.${valid.reason}`);
    }
  }

  let otherTarget: string | null = null;
  if (other) {
    const raw = typeof input.otherUrl === "string" ? input.otherUrl.trim() : "";
    if (raw.length === 0) {
      errors.push("destinationUrl.empty");
    } else {
      const valid = validateDestinationUrl(raw);
      if (valid.ok) otherTarget = valid.url;
      else errors.push(`destinationUrl.${valid.reason}`);
    }
  }

  // Only append a destination that the base text does not already contain —
  // so re-running the builder over its own output is idempotent.
  const appended: ComposedLink[] = [];
  const links: ComposedLink[] = [];

  if (bot) {
    links.push({ kind: "bot", value: "{link}" });
    if (!text.includes("{link}")) appended.push({ kind: "bot", value: "{link}" });
  }
  if (channelTarget) {
    links.push({ kind: "channel", value: channelTarget });
    if (!text.includes(channelTarget)) appended.push({ kind: "channel", value: channelTarget });
  }
  if (otherTarget) {
    links.push({ kind: "other", value: otherTarget });
    if (!text.includes(otherTarget)) appended.push({ kind: "other", value: otherTarget });
  }

  let body = text;
  if (cta.length > 0 && !body.includes(cta)) {
    body = body.length > 0 ? `${body}\n\n${cta}` : cta;
  }
  if (appended.length > 0) {
    body = `${body}\n\n${appended.map((link) => link.value).join("\n")}`;
  }

  if (body.length > MESSAGE_MAX_LENGTH) errors.push("message.tooLong");
  if (errors.length > 0) {
    // Still return a best-effort body for the UI's "what would be sent" panel,
    // but callers must gate saving on `errors.length === 0`.
    return { body, links, errors, appended };
  }

  return { body, links, errors, appended };
}

/**
 * Render the preview exactly the way `prepareInvitations` will render the
 * stored body — same function, same variables. `sampleLink` stands in for the
 * per-recipient bot deep link.
 */
export function previewCampaignMessage(
  input: ComposeInput,
  options: {
    businessName: string;
    sampleLink: string;
    categoryLabel: string;
  }
): { body: string; composed: ComposedMessage } {
  const composed = composeCampaignMessage(input);
  const body = renderTemplate(composed.body, {
    businessName: options.businessName,
    link: options.sampleLink,
    categoryLabel: options.categoryLabel,
  });
  return { body, composed };
}

/** RTL for Persian/Arabic, LTR otherwise — mirrors the app's i18n routing. */
export function messageDirection(language: unknown): "rtl" | "ltr" {
  const lower = typeof language === "string" ? language.toLowerCase() : "";
  return lower.startsWith("fa") || lower.startsWith("ar") || lower.startsWith("pe")
    ? "rtl"
    : "ltr";
}

/**
 * Explain a compose error code in a stable format for tests and the UI.
 * The admin panel renders these codes next to the offending field.
 */
export function describeComposeError(code: string): string {
  const [head] = code.split(":");
  switch (head) {
    case "destinations.none":
      return "Select at least one destination for the message.";
    case "message.empty":
      return "The invitation message is required.";
    case "message.tooLong":
      return `The final message exceeds ${MESSAGE_MAX_LENGTH} characters.`;
    case "placeholder.linkWithoutBot":
      return "The message contains {link} but the bot destination is switched off.";
    case "placeholder.unknown":
      return `Unknown placeholder ${code.slice(code.indexOf(":") + 1)}. Allowed: {businessName}, {link}, {category}.`;
    case "channelUrl.notConfigured":
      return "The Bookora channel URL has not been configured yet (Discovery → Channel link). Add the real public link first.";
    case "destinationUrl.empty":
      return "Fill in the destination URL for this campaign.";
    default: {
      const [, reason] = code.split(".");
      if (reason === "scheme") return "Only http(s) links are allowed (javascript: and similar schemes are rejected).";
      if (reason === "tooLong") return "The URL is too long.";
      return "Invalid URL.";
    }
  }
}
