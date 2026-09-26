export type PlanCode = "PRO_MONTHLY" | "PRO_YEARLY";

export type PlanDefinition = {
  code: PlanCode;
  titleFa: string;
  titleEn: string;
  starsPrice: number;
  durationDays: number;
};

// قیمت‌ها Placeholder هستن — هر وقت خواستی فقط همین اعداد رو عوض کن.
export const PLANS: Record<PlanCode, PlanDefinition> = {
  PRO_MONTHLY: {
    code: "PRO_MONTHLY",
    titleFa: "اشتراک حرفه‌ای ماهانه",
    titleEn: "Pro Monthly",
    starsPrice: 200,
    durationDays: 30,
  },
  PRO_YEARLY: {
    code: "PRO_YEARLY",
    titleFa: "اشتراک حرفه‌ای سالانه",
    titleEn: "Pro Yearly",
    starsPrice: 2000,
    durationDays: 365,
  },
};

export function isPlanCode(value: string): value is PlanCode {
  return value === "PRO_MONTHLY" || value === "PRO_YEARLY";
}

export function buildInvoicePayload(plan: PlanCode, userId: string): string {
  return `sub:${plan}:${userId}`;
}

export function parseInvoicePayload(
  payload: string
): { plan: PlanCode; userId: string } | null {
  const parts = payload.split(":");

  if (parts.length !== 3 || parts[0] !== "sub") {
    return null;
  }

  const [, plan, userId] = parts;

  if (!isPlanCode(plan) || !userId) {
    return null;
  }

  return { plan, userId };
}
