export const BUSINESS_SCHEMA_MIGRATION_REQUIRED =
  "BUSINESS_SCHEMA_MIGRATION_REQUIRED" as const;

export type PrismaSchemaMismatch = {
  code: "P2021" | "P2022";
  modelName?: string;
  column?: string;
};

/**
 * Extract only the safe schema identifiers from Prisma's missing-table/column
 * errors. Do not log the full error object: raw query errors can contain values.
 */
export function getPrismaSchemaMismatch(
  error: unknown
): PrismaSchemaMismatch | null {
  if (!error || typeof error !== "object") return null;

  const candidate = error as {
    code?: unknown;
    meta?: unknown;
  };
  if (candidate.code !== "P2021" && candidate.code !== "P2022") return null;

  const meta =
    candidate.meta && typeof candidate.meta === "object"
      ? (candidate.meta as Record<string, unknown>)
      : null;
  const modelName =
    typeof meta?.modelName === "string" ? meta.modelName : undefined;
  const column = typeof meta?.column === "string" ? meta.column : undefined;
  const table = typeof meta?.table === "string" ? meta.table : undefined;
  const businessSchemaIdentifier = /business(?:es)?|holidays/i;

  if (
    ![modelName, column, table].some(
      (value) => value !== undefined && businessSchemaIdentifier.test(value)
    )
  ) {
    return null;
  }

  return {
    code: candidate.code,
    ...(modelName ? { modelName } : {}),
    ...(column ? { column } : {}),
  };
}
