import { isIP } from "node:net";
import { NextRequest } from "next/server";

function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim().replace(/^\[|\]$/g, "");
  if (!candidate || isIP(candidate) === 0) return null;

  const lower = candidate.toLowerCase();
  const mappedV4 = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedV4 && isIP(mappedV4[1]) === 4) return mappedV4[1];
  return lower;
}

function firstValid(value: string | null): string | null {
  if (!value) return null;
  for (const part of value.split(",")) {
    const ip = normalizeIp(part);
    if (ip) return ip;
  }
  return null;
}

export function getClientIp(req: NextRequest): string {
  // Vercel overwrites this platform header at the trusted edge.
  const vercelIp = firstValid(req.headers.get("x-vercel-forwarded-for"));
  if (vercelIp) return vercelIp;

  // Also provided by common reverse proxies; accept only a syntactically valid IP.
  const realIp = firstValid(req.headers.get("x-real-ip"));
  if (realIp) return realIp;

  // Most proxies append the connected client to the right-hand side of XFF.
  // In Vercel production the platform header above is preferred.
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const parts = forwardedFor.split(",");
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const ip = normalizeIp(parts[i]);
      if (ip) return ip;
    }
  }

  // A constant fallback is safer than allowing arbitrary header strings to
  // create unbounded limiter keys. Production proxies should set a real IP.
  return "unknown";
}
