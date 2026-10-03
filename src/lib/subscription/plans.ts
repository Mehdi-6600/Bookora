export type PlanCode = "PRO_MONTHLY" | "PRO_YEARLY";

export type PlanDefinition = {
  code: PlanCode;
  titleFa: string;
  titleEn: string;
  starsPrice: number;
  manualPriceToman: number;
  durationDays: number;
};

export const PLANS: Record<PlanCode, PlanDefinition> = {
  PRO_MONTHLY: {
    code: "PRO_MONTHLY",
    titleFa: "اشتراک حرفه‌ای ماهانه",
    titleEn: "Pro Monthly",
    starsPrice: 200,
    manualPriceToman: 699000,
    durationDays: 30,
  },
  PRO_YEARLY: {
    code: "PRO_YEARLY",
    titleFa: "اشتراک حرفه‌ای سالانه",
    titleEn: "Pro Yearly",
    starsPrice: 2000,
    manualPriceToman: 6990000,
    durationDays: 365,
  },
};

export const FREE_BUSINESS_LIMIT = 1;

export function isPlanCode(value: string): value is PlanCode {
  return value === "PRO_MONTHLY" || value === "PRO_YEARLY";
}

const USER_ID_PATTERN = /^[a-z0-9]{20,40}$/;

export function buildInvoicePayload(plan: PlanCode, userId: string): string {
  return "sub:" + plan + ":" + userId;
}

export function parseInvoicePayload(
  payload: string
): { plan: PlanCode; userId: string } | null {
  if (typeof payload !== "string") return null;
  if (payload.length > 200) return null;

  const parts = payload.split(":");
  if (parts.length !== 3) return null;
  if (parts[0] !== "sub") return null;

  const plan = parts[1];
  const userId = parts[2];

  if (!isPlanCode(plan)) return null;
  if (!USER_ID_PATTERN.test(userId)) return null;

  return { plan, userId };
}
