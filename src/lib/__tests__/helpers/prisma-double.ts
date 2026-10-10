/**
 * In-memory stand-in for the subset of the Prisma client used by the outreach
 * acquisition pipeline. It is deliberately strict: any model method or where
 * operator it does not implement throws, so a test can never silently pass
 * against behaviour the double does not model.
 *
 * Tables are plain arrays on `state.tables[<delegate name>]`.
 */

type Row = Record<string, any>;
type Where = Record<string, any> | undefined;

type DoubleState = { tables: Record<string, Row[]>; seq: number };

/** Relation fields the pipeline reads, keyed by model delegate name. */
const RELATIONS: Record<string, Record<string, { table: string; fk: string; many: boolean; localKey?: string }>> = {
  outreachProspect: {
    botStarts: { table: "botStart", fk: "prospectId", many: true },
    invitations: { table: "outreachInvitation", fk: "prospectId", many: true },
    campaign: { table: "outreachCampaign", fk: "id", many: false, localKey: "campaignId" },
  },
};

/** Defaults applied on create so rows look like the Prisma model defaults. */
const DEFAULTS: Record<string, Row> = {
  outreachProspect: {
    verificationStatus: "DISCOVERED",
    status: "NEW",
    optedOutAt: null,
    nextFollowUpAt: null,
    campaignId: null,
    telegramUsername: null,
    publicUrl: null,
    city: null,
    segment: null,
    notes: null,
  },
  discoveryCandidate: { status: "NEW", prospectId: null, city: null, segment: null },
  discoveryRun: { discovered: 0, matched: 0, duplicates: 0, excluded: 0, error: null, finishedAt: null },
  outreachSuppression: { note: null },
  adminSetting: {},
};

const UNIQUE_KEYS: Record<string, string[][]> = {
  outreachProspect: [["dedupeKey"]],
  discoveryCandidate: [["dedupeKey"]],
  discoveryRun: [["runDate"]],
  adminSetting: [["key"]],
  outreachSuppression: [["identifier"]],
  discoveryKeyword: [["group", "language", "term"]],
};

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function matchesValue(actual: unknown, condition: unknown): boolean {
  if (condition === undefined) return true;
  if (condition === null) return actual === null || actual === undefined;
  if (condition instanceof Date) {
    return actual instanceof Date && actual.getTime() === condition.getTime();
  }
  if (!isPlainObject(condition)) return actual === condition;

  for (const [op, operand] of Object.entries(condition)) {
    switch (op) {
      case "in":
        if (!(operand as unknown[]).includes(actual)) return false;
        break;
      case "notIn":
        if ((operand as unknown[]).includes(actual)) return false;
        break;
      case "not":
        if (operand === null) {
          if (actual === null || actual === undefined) return false;
        } else if (matchesValue(actual, operand)) {
          return false;
        }
        break;
      case "equals":
        if (actual !== operand) return false;
        break;
      case "contains":
        if (!String(actual ?? "").toLowerCase().includes(String(operand).toLowerCase())) return false;
        break;
      case "lte":
        if (!(actual instanceof Date && operand instanceof Date && actual.getTime() <= operand.getTime())) return false;
        break;
      case "gte":
        if (!(actual instanceof Date && operand instanceof Date && actual.getTime() >= operand.getTime())) return false;
        break;
      case "mode":
        break;
      default:
        throw new Error(`prisma-double: unsupported filter operator "${op}"`);
    }
  }
  return true;
}

function matchesWhere(db: DoubleState, model: string, row: Row, where: Where): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue;
    if (key === "AND") {
      if (!(condition as Where[]).every((item) => matchesWhere(db, model, row, item))) return false;
      continue;
    }
    if (key === "OR") {
      if (!(condition as Where[]).some((item) => matchesWhere(db, model, row, item))) return false;
      continue;
    }
    if (key === "NOT") {
      if (matchesWhere(db, model, row, condition as Where)) return false;
      continue;
    }
    const relation = RELATIONS[model]?.[key];
    if (relation) {
      const related = relatedRows(db, model, row, key);
      if (!isPlainObject(condition)) throw new Error(`prisma-double: bad relation filter ${key}`);
      for (const [op, nested] of Object.entries(condition)) {
        const matching = related.filter((item) => matchesWhere(db, relation.table, item, nested as Where));
        if (op === "some" && matching.length === 0) return false;
        if (op === "none" && matching.length > 0) return false;
        if (op !== "some" && op !== "none") throw new Error(`prisma-double: unsupported relation op ${op}`);
      }
      continue;
    }
    if (!matchesValue(row[key], condition)) return false;
  }
  return true;
}

function relatedRows(db: DoubleState, model: string, row: Row, key: string): Row[] {
  const relation = RELATIONS[model][key];
  const table = db.tables[relation.table] ?? [];
  if (relation.many) return table.filter((item) => item[relation.fk] === row.id);
  const target = table.find((item) => item[relation.fk] === row[relation.localKey ?? ""]);
  return target ? [target] : [];
}

function project(db: DoubleState, model: string, row: Row, args: Record<string, any> | undefined): Row {
  const include = args?.include as Record<string, any> | undefined;
  const select = args?.select as Record<string, any> | undefined;
  const out: Row = {};

  if (select) {
    for (const [key, value] of Object.entries(select)) {
      if (!value) continue;
      out[key] = RELATIONS[model]?.[key] ? projectRelation(db, model, row, key, value) : row[key];
    }
    return out;
  }

  Object.assign(out, row);
  if (include) {
    for (const [key, value] of Object.entries(include)) {
      if (!value) continue;
      if (!RELATIONS[model]?.[key]) throw new Error(`prisma-double: unsupported include ${model}.${key}`);
      out[key] = projectRelation(db, model, row, key, value);
    }
  }
  return out;
}

function projectRelation(db: DoubleState, model: string, row: Row, key: string, spec: unknown): unknown {
  const relation = RELATIONS[model][key];
  let rows = relatedRows(db, model, row, key);
  const nested = isPlainObject(spec) ? spec : {};
  if (nested.where) rows = rows.filter((item) => matchesWhere(db, relation.table, item, nested.where));
  if (nested.take !== undefined) rows = rows.slice(0, nested.take);
  const shaped = rows.map((item) =>
    nested.select ? project(db, relation.table, item, { select: nested.select }) : { ...item }
  );
  return relation.many ? shaped : shaped[0] ?? null;
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  if (!orderBy) return rows;
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const clause of clauses) {
      for (const [field, direction] of Object.entries(clause as Record<string, string>)) {
        const av = a[field];
        const bv = b[field];
        const cmp = av instanceof Date && bv instanceof Date ? av.getTime() - bv.getTime() : av < bv ? -1 : av > bv ? 1 : 0;
        if (cmp !== 0) return direction === "desc" ? -cmp : cmp;
      }
    }
    return 0;
  });
}

function uniqueConflict(db: DoubleState, model: string, data: Row, ignore?: Row): boolean {
  for (const fields of UNIQUE_KEYS[model] ?? []) {
    const hit = (db.tables[model] ?? []).some(
      (row) => row !== ignore && fields.every((field) => row[field] === data[field] && data[field] !== undefined)
    );
    if (hit) return true;
  }
  return false;
}

function findUniqueRow(db: DoubleState, model: string, where: Record<string, any>): Row | undefined {
  const flat: Record<string, any> = {};
  for (const [key, value] of Object.entries(where)) {
    // Composite unique keys arrive as { name_field1_field2: { field1, field2 } }.
    if (isPlainObject(value) && key.includes("_") && !RELATIONS[model]?.[key]) Object.assign(flat, value);
    else flat[key] = value;
  }
  return (db.tables[model] ?? []).find((row) => matchesWhere(db, model, row, flat));
}

function createDelegate(db: DoubleState, model: string) {
  const rows = () => {
    if (!db.tables[model]) db.tables[model] = [];
    return db.tables[model];
  };

  const insert = (data: Row): Row => {
    if (uniqueConflict(db, model, data)) {
      throw new Error(`prisma-double: unique constraint failed on ${model}`);
    }
    db.seq += 1;
    const now = new Date(Date.UTC(2026, 0, 1) + db.seq * 1000);
    const row: Row = {
      id: `${model}-${db.seq}`,
      createdAt: now,
      updatedAt: now,
      ...(DEFAULTS[model] ?? {}),
      ...data,
    };
    rows().push(row);
    return { ...row };
  };

  const applyUpdate = (row: Row, data: Row): Row => {
    if (uniqueConflict(db, model, { ...row, ...data }, row)) {
      throw new Error(`prisma-double: unique constraint failed on ${model}`);
    }
    for (const [key, value] of Object.entries(data)) {
      if (isPlainObject(value) && ("increment" in value || "set" in value)) {
        row[key] = "increment" in value ? (row[key] ?? 0) + value.increment : value.set;
      } else {
        row[key] = value;
      }
    }
    row.updatedAt = new Date();
    return { ...row };
  };

  return {
    async findUnique(args: { where: Record<string, any> } & Record<string, any>) {
      const row = findUniqueRow(db, model, args.where);
      return row ? project(db, model, row, args) : null;
    },
    async findFirst(args: { where?: Where; orderBy?: unknown } & Record<string, any> = { where: undefined }) {
      const found = sortRows((db.tables[model] ?? []).filter((row) => matchesWhere(db, model, row, args.where)), args.orderBy);
      return found[0] ? project(db, model, found[0], args) : null;
    },
    async findMany(args: { where?: Where; orderBy?: unknown; take?: number; skip?: number } & Record<string, any> = {}) {
      let found = sortRows((db.tables[model] ?? []).filter((row) => matchesWhere(db, model, row, args.where)), args.orderBy);
      if (args.skip) found = found.slice(args.skip);
      if (args.take !== undefined) found = found.slice(0, args.take);
      return found.map((row) => project(db, model, row, args));
    },
    async count(args: { where?: Where } = {}) {
      return (db.tables[model] ?? []).filter((row) => matchesWhere(db, model, row, args.where)).length;
    },
    async create(args: { data: Row } & Record<string, any>) {
      return project(db, model, insert(args.data), args);
    },
    async update(args: { where: Record<string, any>; data: Row } & Record<string, any>) {
      const row = findUniqueRow(db, model, args.where);
      if (!row) throw new Error(`prisma-double: ${model} record to update not found`);
      return project(db, model, applyUpdate(row, args.data), args);
    },
    async updateMany(args: { where?: Where; data: Row }) {
      const targets = (db.tables[model] ?? []).filter((row) => matchesWhere(db, model, row, args.where));
      targets.forEach((row) => applyUpdate(row, args.data));
      return { count: targets.length };
    },
    async upsert(args: { where: Record<string, any>; create: Row; update: Row } & Record<string, any>) {
      const row = findUniqueRow(db, model, args.where);
      if (row) return project(db, model, applyUpdate(row, args.update), args);
      return project(db, model, insert({ ...flattenWhere(args.where), ...args.create }), args);
    },
    async delete(args: { where: Record<string, any> }) {
      const row = findUniqueRow(db, model, args.where);
      if (!row) throw new Error(`prisma-double: ${model} record to delete not found`);
      rows().splice(rows().indexOf(row), 1);
      return { ...row };
    },
    async groupBy(args: { by: string[]; where?: Where; _count?: unknown }) {
      const groups = new Map<string, Row & { _count: { _all: number } }>();
      for (const row of (db.tables[model] ?? []).filter((item) => matchesWhere(db, model, item, args.where))) {
        const key = JSON.stringify(args.by.map((field) => row[field] ?? null));
        const group = groups.get(key) ?? {
          ...Object.fromEntries(args.by.map((field) => [field, row[field] ?? null])),
          _count: { _all: 0 },
        };
        group._count._all += 1;
        groups.set(key, group);
      }
      return [...groups.values()];
    },
    async aggregate(args: { where?: Where; _sum?: Record<string, boolean> }) {
      const matching = (db.tables[model] ?? []).filter((row) => matchesWhere(db, model, row, args.where));
      const sums: Record<string, number> = {};
      for (const field of Object.keys(args._sum ?? {})) {
        sums[field] = matching.reduce((total, row) => total + (typeof row[field] === "number" ? row[field] : 0), 0);
      }
      return { _sum: sums };
    },
  };
}

function flattenWhere(where: Record<string, any>): Row {
  const flat: Row = {};
  for (const [key, value] of Object.entries(where)) {
    if (isPlainObject(value) && key.includes("_")) Object.assign(flat, value);
    else flat[key] = value;
  }
  return flat;
}

export function createPrismaDouble(state: DoubleState) {
  const delegates = new Map<string, ReturnType<typeof createDelegate>>();
  const models = [
    "adminSetting",
    "booking",
    "business",
    "botStart",
    "discoveryCandidate",
    "discoveryKeyword",
    "discoveryRun",
    "invitationTemplate",
    "outreachAuditEvent",
    "outreachCampaign",
    "outreachInvitation",
    "outreachProspect",
    "outreachSuppression",
    "subscription",
    "user",
  ];

  const prisma: Record<string, unknown> = {};
  for (const model of models) {
    const delegate = createDelegate(state as DoubleState, model);
    delegates.set(model, delegate);
    prisma[model] = new Proxy(delegate, {
      get(target, prop: string | symbol) {
        if (typeof prop === "symbol" || prop in target) {
          return target[prop as keyof typeof target];
        }
        throw new Error(`prisma-double: ${model}.${String(prop)} is not modelled`);
      },
    });
  }
  prisma.$transaction = async (work: unknown) => {
    if (typeof work === "function") return work(prisma);
    return Promise.all(work as Promise<unknown>[]);
  };
  return prisma;
}
