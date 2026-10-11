/**
 * Minimal stand-in for the generated Prisma client.
 *
 * `prisma generate` cannot run in this sandbox (the engine download is
 * blocked), so the runtime `@prisma/client` exports no `Decimal`. Tests that
 * exercise money arithmetic import the real `decimal.js` — the same library
 * the generated client wraps — through this module.
 */
import DecimalJs from "decimal.js";

export class PrismaClientKnownRequestError extends Error {
  code: string;
  meta?: Record<string, unknown>;
  constructor(message: string, options: { code: string; meta?: Record<string, unknown> }) {
    super(message);
    this.name = "PrismaClientKnownRequestError";
    this.code = options.code;
    this.meta = options.meta;
  }
}

export const Prisma = {
  Decimal: DecimalJs,
  PrismaClientKnownRequestError,
  /** Type-only helper used by the repository's signatures. */
  TransactionClient: undefined as unknown,
};
