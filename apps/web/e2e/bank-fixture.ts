import {
  ANSWER_CATEGORIES,
  ANSWER_STATUSES,
  approveBankEntrySchema,
  bankEntryDefinitionSchema,
  bankVersionSchema,
  editBankEntrySchema,
  requiresSpecificContext,
} from "@jobpilot/contracts/information-bank";
import { paginationQuerySchema } from "@jobpilot/contracts/pagination";
import { z } from "zod/v4";
import type { BankEntry } from "../src/components/features/information-bank/bank-options";

const rows = new Map<string, BankEntry>();
const events = new Map<
  string,
  {
    id: string;
    version: number;
    action: string;
    createdAt: Date;
    definition: BankEntry["definition"] | null;
  }[]
>();
let writes = 0;
const searchSchema = paginationQuerySchema.extend({
  query: z.string().optional(),
  category: z.enum(ANSWER_CATEGORIES).optional(),
  status: z.enum(ANSWER_STATUSES).optional(),
});
function record(row: BankEntry, action: string) {
  const history = events.get(row.id) ?? [];
  history.unshift({
    id: crypto.randomUUID(),
    version: row.version,
    action,
    createdAt: new Date(),
    definition: structuredClone(row.definition),
  });
  events.set(row.id, history);
}
export function resetBankFixture() {
  rows.clear();
  events.clear();
  writes = 0;
}
export function bankFixtureState() {
  return { bankWrites: writes, bankIds: [...rows.keys()] };
}
export async function handleBankFixture(
  request: Request,
  json: (value: unknown, status?: number) => Response,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/test/change-bank") {
    const row = rows.values().next().value;
    if (row) {
      row.version++;
      row.status = "draft";
      row.ready = false;
      row.approvedAt = null;
      row.reviewDueAt = null;
      row.definition.answer = { kind: "text", value: "Externally updated fixture" };
    }
    return json({ ok: true });
  }
  if (!url.pathname.startsWith("/api/information-bank")) return null;
  const fail = (message: string, status = 422) =>
    json({ code: status === 409 ? "STALE_WRITE" : "UNPROCESSABLE", message }, status);
  if (url.pathname === "/api/information-bank/search") {
    const query = searchSchema.parse(await request.json());
    const words = query.query?.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
    const filtered = [...rows.values()].filter(
      (row) =>
        (!query.category || row.definition.category === query.category) &&
        (!query.status || row.status === query.status) &&
        words.every((word) =>
          [row.definition.question, ...row.definition.aliases]
            .join(" ")
            .toLowerCase()
            .includes(word),
        ),
    );
    return json({
      items: filtered.slice((query.page - 1) * query.limit, query.page * query.limit),
      pagination: {
        ...query,
        total: filtered.length,
        totalPages: Math.ceil(filtered.length / query.limit),
      },
    });
  }
  if (url.pathname === "/api/information-bank/export")
    return json({ exportedAt: new Date(), entries: [...rows.values()] });
  if (url.pathname === "/api/information-bank" && request.method === "POST") {
    const parsed = bankEntryDefinitionSchema.safeParse(await request.json());
    if (!parsed.success) return fail("Invalid draft");
    const row: BankEntry = {
      id: crypto.randomUUID(),
      version: 1,
      status: "draft",
      ready: false,
      sensitive: requiresSpecificContext(parsed.data),
      approvedAt: null,
      reviewDueAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      definition: parsed.data,
      source: { kind: "user_entered", referenceId: null, referenceVersion: null },
    };
    rows.set(row.id, row);
    writes++;
    record(row, "created");
    return json(row);
  }
  const match = /^\/api\/information-bank\/([^/]+)(?:\/(approve|revoke|history))?$/.exec(
    url.pathname,
  );
  if (!match) return fail("Fixture operation unavailable", 404);
  const id = match[1]!;
  const action = match[2];
  const row = rows.get(id);
  if (action === "history") {
    const query = paginationQuerySchema.parse(Object.fromEntries(url.searchParams));
    const history = (events.get(id) ?? []).map((event) => ({
      ...event,
      definition: row ? event.definition : null,
    }));
    return json({
      items: history.slice((query.page - 1) * query.limit, query.page * query.limit),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: history.length,
        totalPages: Math.ceil(history.length / query.limit),
      },
    });
  }
  if (!row) return fail("Answer not found", 404);
  if (request.method === "GET") return json(row);
  const input = await request.json();
  const version = bankVersionSchema.passthrough().safeParse(input);
  if (!version.success) return fail("Missing version");
  if (version.data.expectedVersion !== row.version)
    return fail("Answer changed. Reload before saving.", 409);
  if (request.method === "PATCH") {
    const parsed = editBankEntrySchema.safeParse(input);
    if (!parsed.success) return fail("Invalid answer");
    row.definition = parsed.data.definition;
    row.status = "draft";
    row.ready = false;
    row.sensitive = requiresSpecificContext(row.definition);
    row.approvedAt = null;
    row.reviewDueAt = null;
  } else if (request.method === "DELETE") {
    rows.delete(id);
    writes++;
    const deleted = { ...row, version: row.version + 1 };
    record(deleted, "deleted");
    return json({ deleted: id });
  } else if (action === "approve") {
    const parsed = approveBankEntrySchema.safeParse(input);
    if (!parsed.success) return fail("Invalid review date");
    const due = new Date(parsed.data.reviewDueAt);
    const days = row.sensitive ? 7 : 90;
    if (
      (row.sensitive && row.definition.scope !== "job") ||
      due <= new Date() ||
      due.getTime() > Date.now() + days * 86_400_000
    )
      return fail("Review scope or date is invalid", 400);
    row.status = "approved";
    row.ready = true;
    row.approvedAt = new Date();
    row.reviewDueAt = due;
  } else if (action === "revoke") {
    row.status = "revoked";
    row.ready = false;
    row.approvedAt = null;
    row.reviewDueAt = null;
  } else return fail("Fixture operation denied", 403);
  row.version++;
  row.updatedAt = new Date();
  writes++;
  const eventAction = action === "approve" ? "approved" : action;
  record(row, eventAction === "revoke" ? "revoked" : (eventAction ?? "edited"));
  return json(row);
}
