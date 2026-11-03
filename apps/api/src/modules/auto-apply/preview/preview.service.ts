import { createHash } from "node:crypto";
import type { AutoApplyPreferences } from "@jobpilot/contracts/auto-apply";
import { ingestionBatchSchema } from "@jobpilot/contracts/ingestion";
import { type PaginationQuery, pageSlice, paginate } from "@jobpilot/contracts/pagination";
import { simulatePolicySchema } from "@jobpilot/contracts/policy-preview";
import { inject, injectable } from "@needle-di/core";
import type { z } from "zod/v4";
import { requireReviewSession } from "@/common/auth/require-review-session";
import { conflict, notFound } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { type DryRunSimulation, type Prisma, PrismaClient } from "@/generated/prisma/client";
import { getExecutionPolicy } from "@/modules/execution/execution-policy";
import { policyPreferences } from "../auto-apply.preferences";
import { batchDuplicateGuard } from "./batch-duplicates";
import { quotaDay } from "./day-window";
import { evaluatePolicy } from "./evaluate";
import { type previewQuerySchema, previewSnapshotSchema } from "./preview.schema";
import { PreviewEvidenceService } from "./preview-evidence.service";
import { readQuota } from "./quota";
import { selectResume } from "./resume-selection";

type Snapshot = z.infer<typeof previewSnapshotSchema>;
type Job = z.infer<typeof ingestionBatchSchema>["jobs"][number];

@injectable()
export class PolicyPreviewService {
  constructor(
    private readonly prisma: PrismaClient = inject(PrismaClient),
    private readonly evidence: PreviewEvidenceService = inject(PreviewEvidenceService),
  ) {}
  private async lock(tx: Prisma.TransactionClient, userId: string) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    if (!rows.length) throw notFound("Account not found");
  }
  private async runJobs(tx: Prisma.TransactionClient, userId: string, id?: string) {
    if (!id) return [];
    const run = await tx.ingestionRun.findFirst({ where: { id, integration: { userId } } });
    if (!run) throw notFound("Discovery run not found");
    return ingestionBatchSchema.parse(run.batch).jobs;
  }
  private async assess(
    tx: Prisma.TransactionClient,
    userId: string,
    settings: AutoApplyPreferences,
    job: Job,
    remaining: number,
    now: Date,
    manualId?: string,
  ) {
    const [existing, pending, similar, similarPending, resume] = await Promise.all([
      tx.application.findFirst({ where: { userId, url: job.url }, select: { id: true } }),
      tx.dryRunReservation.findFirst({
        where: {
          userId,
          createdAt: { gte: new Date(now.getTime() - 86_400_000) },
          OR: [{ sourceId: job.sourceId }, { url: job.url }],
        },
        select: { id: true },
      }),
      tx.application.findFirst({
        where: {
          userId,
          url: { not: job.url },
          title: { equals: job.title, mode: "insensitive" },
          company: { equals: job.company, mode: "insensitive" },
        },
        select: { id: true },
      }),
      tx.dryRunReservation.findFirst({
        where: {
          userId,
          createdAt: { gte: new Date(now.getTime() - 86_400_000) },
          url: { not: job.url },
          title: { equals: job.title, mode: "insensitive" },
          company: { equals: job.company, mode: "insensitive" },
        },
        select: { id: true },
      }),
      selectResume(tx, userId, settings, job.title, manualId),
    ]);
    const outcome = evaluatePolicy(settings, this.evidence.facts(job, settings.roles), {
      approvedResume: !!resume,
      manualResumeSelected: settings.resumeSelection !== "manual" || !!manualId,
      duplicateApplication: !!existing,
      duplicateInProgress: !!pending,
      duplicateUncertain: !!similar || !!similarPending,
      remaining,
    });
    return {
      sourceId: job.sourceId,
      title: job.title,
      company: job.company,
      url: job.url,
      resume,
      outcome,
    };
  }
  async preview(userId: string, query: z.infer<typeof previewQuerySchema>) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx, userId);
        const row = await tx.autoApplyPolicy.findUnique({ where: { userId } });
        const settings = policyPreferences(row);
        const now = new Date();
        const quota = await readQuota(tx, userId, settings, now);
        const jobs = await this.runJobs(tx, userId, query.ingestionRunId);
        const outcomes = [];
        const deduplicate = batchDuplicateGuard();
        let remaining = quota.remainingSimulation;
        for (const job of jobs) {
          const result = await this.assess(
            tx,
            userId,
            settings,
            job,
            remaining,
            now,
            query.resumeId,
          );
          deduplicate(result);
          outcomes.push(result);
          if (result.outcome.decision === "eligible_for_dry_run") remaining--;
        }
        return {
          settings,
          settingsVersion: row?.version ?? 0,
          quota,
          jobs: outcomes,
          runtime: getExecutionPolicy(),
        };
      },
      { timeout: 30_000 },
    );
  }
  async simulate(userId: string, tokenId: string, input: z.infer<typeof simulatePolicySchema>) {
    await requireReviewSession(this.prisma, userId, tokenId);
    const request = simulatePolicySchema.parse(input);
    const digest = createHash("sha256")
      .update(
        JSON.stringify([
          request.ingestionRunId,
          request.expectedSettingsVersion,
          request.resumeId ?? null,
        ]),
      )
      .digest("hex");
    return this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx, userId);
        const prior = await tx.dryRunSimulation.findUnique({
          where: { userId_requestId: { userId, requestId: request.requestId } },
        });
        if (prior) {
          if (prior.requestDigest !== digest)
            throw conflict("Simulation request ID already has a different input");
          return this.receipt(prior, true);
        }
        const row = await tx.autoApplyPolicy.findUnique({ where: { userId } });
        if ((row?.version ?? 0) !== request.expectedSettingsVersion)
          throw conflict("Settings changed. Reload before simulating.", "STALE_WRITE");
        const settings = policyPreferences(row);
        const jobs = await this.runJobs(tx, userId, request.ingestionRunId);
        const now = new Date();
        const quota = await readQuota(tx, userId, settings, now);
        const outcomes: Snapshot["jobs"] = [];
        const allocations: Prisma.DryRunReservationCreateManyInput[] = [];
        const simulationId = crypto.randomUUID();
        const deduplicate = batchDuplicateGuard();
        for (const job of jobs) {
          const result = await this.assess(
            tx,
            userId,
            settings,
            job,
            quota.remainingSimulation - allocations.length,
            now,
            request.resumeId,
          );
          deduplicate(result);
          if (result.outcome.decision === "eligible_for_dry_run" && result.resume) {
            // Locks prevent a concurrent edit/revocation from changing the selected version before this commit.
            await tx.$queryRaw`SELECT id FROM resumes WHERE id = ${result.resume.id} AND user_id = ${userId} FOR UPDATE`;
            const current = await tx.resume.findFirst({
              where: { id: result.resume.id, userId, active: true, approvedAt: { not: null } },
            });
            if (
              !current ||
              current.version !== result.resume.version ||
              current.approvedVersion !== current.version ||
              current.reviewRevision !== result.resume.reviewRevision
            )
              throw conflict("Resume changed. Review before simulating.", "STALE_WRITE");
            allocations.push({
              id: crypto.randomUUID(),
              userId,
              simulationId,
              sourceId: job.sourceId,
              url: job.url,
              title: job.title,
              company: job.company,
              dayStartsAt: quota.startsAt,
              resumeId: current.id,
              resumeVersion: current.version,
              resumeReviewRevision: current.reviewRevision,
              settingsVersion: row?.version ?? 0,
              createdAt: now,
            });
          }
          outcomes.push(result);
        }
        if (quotaDay(new Date(), settings.timeZone).startsAt.getTime() !== quota.startsAt.getTime())
          throw conflict("The quota day changed. Retry the simulation.", "STALE_WRITE");
        const snapshot = previewSnapshotSchema.parse({
          settings,
          settingsVersion: row?.version ?? 0,
          quota: {
            ...quota,
            dryRunReservations: quota.dryRunReservations + allocations.length,
            remainingSimulation: quota.remainingSimulation - allocations.length,
          },
          jobs: outcomes,
        });
        const saved = await tx.dryRunSimulation.create({
          data: {
            id: simulationId,
            userId,
            requestId: request.requestId,
            requestDigest: digest,
            ingestionRunId: request.ingestionRunId,
            settingsVersion: row?.version ?? 0,
            snapshot: toInputJson(snapshot),
            createdAt: now,
          },
        });
        if (allocations.length) await tx.dryRunReservation.createMany({ data: allocations });
        return this.receipt(saved, false);
      },
      { timeout: 30_000 },
    );
  }
  private receipt(row: DryRunSimulation, duplicate: boolean) {
    return {
      ...previewSnapshotSchema.parse(row.snapshot),
      id: row.id,
      requestId: row.requestId,
      ingestionRunId: row.ingestionRunId,
      createdAt: row.createdAt,
      duplicate,
      runtime: getExecutionPolicy(),
    };
  }
  async get(userId: string, id: string) {
    const row = await this.prisma.dryRunSimulation.findFirst({ where: { id, userId } });
    if (!row) throw notFound("Simulation not found");
    return this.receipt(row, false);
  }
  async history(userId: string, query: PaginationQuery) {
    const where = { userId };
    const [rows, total] = await Promise.all([
      this.prisma.dryRunSimulation.findMany({
        where,
        ...pageSlice(query),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          requestId: true,
          ingestionRunId: true,
          settingsVersion: true,
          createdAt: true,
        },
      }),
      this.prisma.dryRunSimulation.count({ where }),
    ]);
    return paginate(rows, query, total);
  }
}
