import {
  AUTO_APPLY_DEFAULTS,
  type AutoApplyPreferences,
  autoApplyPreferencesSchema,
  patchAutoApplySettingsSchema,
} from "@jobpilot/contracts/auto-apply";
import { type PaginationQuery, pageSlice, paginate } from "@jobpilot/contracts/pagination";
import { inject, injectable } from "@needle-di/core";
import { conflict, unprocessable } from "@/common/errors";
import { prismaCode } from "@/common/errors/prisma";
import { toInputJson } from "@/common/json";
import { type AutoApplyPolicy, PrismaClient } from "@/generated/prisma/client";
import { getExecutionPolicy } from "@/modules/execution/execution-policy";

function preferences(row: AutoApplyPolicy | null): AutoApplyPreferences {
  if (!row) return autoApplyPreferencesSchema.parse(AUTO_APPLY_DEFAULTS);
  const { userId: _, version: __, updatedAt: ___, ...fields } = row;
  return autoApplyPreferencesSchema.parse({
    ...fields,
    workArrangements: fields.workArrangements.map((value) =>
      value === "OnSite" ? "On-site" : value,
    ),
  });
}

function stored(value: AutoApplyPreferences) {
  return {
    ...value,
    workArrangements: value.workArrangements.map((value) =>
      value === "On-site" ? ("OnSite" as const) : value,
    ),
  };
}

function stale() {
  return conflict("Settings changed. Reload before saving.", "STALE_WRITE");
}

@injectable()
export class AutoApplyService {
  constructor(private readonly prisma: PrismaClient = inject(PrismaClient)) {}

  async get(userId: string) {
    const row = await this.prisma.autoApplyPolicy.findUnique({ where: { userId } });
    return this.response(userId, row);
  }

  private async response(userId: string, row: AutoApplyPolicy | null) {
    const settings = preferences(row);
    const approved = await this.prisma.resume.findMany({
      where: {
        userId,
        active: true,
        approvedAt: { not: null },
        ...(settings.resumeSelection === "fixed" && { id: settings.fixedResumeId! }),
      },
      select: { version: true, approvedVersion: true },
    });
    return {
      settings,
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt ?? null,
      runtime: getExecutionPolicy(),
      resumeReady: approved.some((resume) => resume.approvedVersion === resume.version),
    };
  }

  async patch(userId: string, actorTokenId: string, input: unknown) {
    const parsed = patchAutoApplySettingsSchema.safeParse(input);
    if (!parsed.success) throw unprocessable("Invalid settings patch", parsed.error.flatten());
    const { expectedVersion, changes } = parsed.data;
    let saved: AutoApplyPolicy;
    try {
      saved = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.autoApplyPolicy.findUnique({ where: { userId } });
        if ((existing?.version ?? 0) !== expectedVersion) throw stale();
        const previous = preferences(existing);
        const merged = autoApplyPreferencesSchema.safeParse({ ...previous, ...changes });
        if (!merged.success) throw unprocessable("Invalid settings", merged.error.flatten());
        const next = merged.data;
        if (next.resumeSelection === "fixed") {
          const resume = await tx.resume.findFirst({
            where: {
              id: next.fixedResumeId!,
              userId,
              active: true,
              approvedAt: { not: null },
            },
            select: { id: true, version: true, approvedVersion: true },
          });
          if (!resume || resume.approvedVersion !== resume.version)
            throw unprocessable("Select an owned, active, approved resume.");
        }
        const version = expectedVersion + 1;
        if (existing) {
          const changed = await tx.autoApplyPolicy.updateMany({
            where: { userId, version: expectedVersion },
            data: { ...stored(next), version },
          });
          if (changed.count !== 1) throw stale();
        } else {
          await tx.autoApplyPolicy.create({ data: { userId, ...stored(next), version } });
        }
        await tx.autoApplyAuditEvent.create({
          data: {
            userId,
            actorTokenId,
            previousVersion: expectedVersion,
            version,
            ...(existing && { previousPreferences: toInputJson(previous) }),
            preferences: toInputJson(next),
          },
        });
        return tx.autoApplyPolicy.findUniqueOrThrow({ where: { userId } });
      });
    } catch (error) {
      if (prismaCode(error) === "P2002") throw stale();
      throw error;
    }
    return this.response(userId, saved);
  }

  async audit(userId: string, query: PaginationQuery) {
    const where = { userId };
    const [rows, total] = await Promise.all([
      this.prisma.autoApplyAuditEvent.findMany({
        where,
        orderBy: { version: "desc" },
        ...pageSlice(query),
      }),
      this.prisma.autoApplyAuditEvent.count({ where }),
    ]);
    return paginate(
      rows.map((row) => ({
        id: row.id,
        previousVersion: row.previousVersion,
        version: row.version,
        createdAt: row.createdAt,
        previousPreferences:
          row.previousPreferences === null
            ? null
            : autoApplyPreferencesSchema.parse(row.previousPreferences),
        preferences: autoApplyPreferencesSchema.parse(row.preferences),
      })),
      query,
      total,
    );
  }
}
