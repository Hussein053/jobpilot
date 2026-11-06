import { createHash } from "node:crypto";
import { ingestionBatchSchema } from "@jobpilot/contracts/ingestion";
import { type PaginationQuery, pageSlice, paginate } from "@jobpilot/contracts/pagination";
import {
  type createPreparationSchema,
  preparationStateSchema,
  type reviewPreparationSchema,
} from "@jobpilot/contracts/preparation";
import { inject, injectable } from "@needle-di/core";
import type { z } from "zod/v4";
import { requireReviewSession } from "@/common/auth/require-review-session";
import { conflict, forbidden, notFound } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { type ApplicationPreparation, type Prisma, PrismaClient } from "@/generated/prisma/client";
import { policyPreferences } from "@/modules/auto-apply/auto-apply.preferences";
import { quotaDay } from "@/modules/auto-apply/preview/day-window";
import { readQuota } from "@/modules/auto-apply/preview/quota";
import { selectResume } from "@/modules/auto-apply/preview/resume-selection";
import { getExecutionPolicy } from "@/modules/execution/execution-policy";
import { AnswerResolutionService } from "@/modules/information-bank/answer-resolution.service";
import { PreparationAnswerHistoryService } from "./answer-history.service";
import { assertFixtureUrl, FIXTURE_FIELDS, simulateFixture } from "./fixture-worker";

type State = z.infer<typeof preparationStateSchema>;
const RUNTIME = {
  mode: "DRY_RUN" as const,
  canSubmit: false as const,
  externalFormsEnabled: false as const,
};
const EXCEPTIONS = [
  "Synthetic fixture only: employer eligibility and match score remain unverified.",
  "Exception approval authorizes simulation only; it does not verify qualifications or permit submission.",
];

@injectable()
export class PreparationService {
  constructor(
    private readonly prisma: PrismaClient = inject(PrismaClient),
    private readonly resolver = inject(AnswerResolutionService),
    private readonly answerHistory = inject(PreparationAnswerHistoryService),
  ) {}
  private async lock(tx: Prisma.TransactionClient, userId: string, tokenId: string) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    if (!rows.length) throw notFound("Account not found");
    await requireReviewSession(tx, userId, tokenId);
    const runtime = getExecutionPolicy();
    if (
      runtime.submissionMode !== "DRY_RUN" ||
      runtime.liveSubmissionsEnabled ||
      runtime.unrestrictedAgentsEnabled
    )
      throw forbidden("Cannot verify the required DRY_RUN boundary.");
  }
  private async owned(tx: Prisma.TransactionClient, userId: string, id: string) {
    const row = await tx.applicationPreparation.findFirst({ where: { id, userId } });
    if (!row) throw notFound("Preparation not found");
    return row;
  }
  private async view(row: ApplicationPreparation, tx: Prisma.TransactionClient = this.prisma) {
    const events = await tx.preparationEvent.findMany({
      where: { preparationId: row.id, userId: row.userId },
      orderBy: { revision: "asc" },
    });
    return {
      ...preparationStateSchema.parse(row.state),
      id: row.id,
      revision: row.revision,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      runtime: RUNTIME,
      audit: events.map((event) => ({
        kind: event.kind,
        at: event.createdAt,
        revision: event.revision,
      })),
    };
  }
  private async questions(
    userId: string,
    job: State["job"],
    db: Pick<PrismaClient, "answerEntry"> = this.prisma,
  ) {
    return Promise.all(
      FIXTURE_FIELDS.map(async (field) => {
        const result = await this.resolver.resolve(
          userId,
          {
            question: field.label,
            intent: field.intent,
            kind: field.kind,
            options: [],
            role: job.title,
            company: job.company,
            jobUrl: job.url,
            verified: true,
          },
          db,
        );
        return {
          ...field,
          status: result.decision === "reuse" ? ("approved" as const) : ("review" as const),
          reason: result.reason,
          entryId: result.decision === "reuse" ? result.entryId : null,
          entryVersion: result.decision === "reuse" ? result.entryVersion : null,
        };
      }),
    );
  }
  private ready(state: State) {
    return (
      !!state.resume &&
      state.exceptions.approved &&
      state.questions.every((question) => !question.required || question.status === "approved")
    );
  }
  async list(userId: string, tokenId: string, query: PaginationQuery) {
    await requireReviewSession(this.prisma, userId, tokenId);
    const where = { userId };
    const [rows, total] = await Promise.all([
      this.prisma.applicationPreparation.findMany({
        where,
        ...pageSlice(query),
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
      this.prisma.applicationPreparation.count({ where }),
    ]);
    return paginate(await Promise.all(rows.map((row) => this.view(row))), query, total);
  }
  async get(userId: string, tokenId: string, id: string) {
    await requireReviewSession(this.prisma, userId, tokenId);
    return this.view(await this.owned(this.prisma, userId, id));
  }
  async create(userId: string, tokenId: string, input: z.infer<typeof createPreparationSchema>) {
    await requireReviewSession(this.prisma, userId, tokenId);
    const digest = createHash("sha256")
      .update(JSON.stringify([input.ingestionRunId, input.sourceId, input.resumeId ?? null]))
      .digest("hex");
    const run = await this.prisma.ingestionRun.findFirst({
      where: { id: input.ingestionRunId, integration: { userId } },
    });
    if (!run) throw notFound("Owned discovery run not found");
    const job = ingestionBatchSchema
      .parse(run.batch)
      .jobs.find((item) => item.sourceId === input.sourceId);
    if (!job) throw notFound("Job not found in this discovery run");
    assertFixtureUrl(job.url);
    const questions = await this.questions(userId, job);
    return this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx, userId, tokenId);
        const previous = await tx.applicationPreparation.findUnique({
          where: { userId_requestId: { userId, requestId: input.requestId } },
        });
        if (previous) {
          if (previous.requestDigest !== digest)
            throw conflict("Request ID was already used with different inputs.");
          return this.view(previous, tx);
        }
        const duplicate = await tx.applicationPreparation.findFirst({
          where: { userId, OR: [{ sourceId: job.sourceId }, { url: job.url }] },
        });
        const historical = await tx.application.findFirst({
          where: { userId, url: job.url },
          select: { id: true },
        });
        if (duplicate || historical)
          throw conflict("Job already has a preparation or historical application.");
        const policy = await tx.autoApplyPolicy.findUnique({ where: { userId } });
        const resume = await selectResume(
          tx,
          userId,
          policyPreferences(policy),
          job.title,
          input.resumeId,
        );
        const state: State = {
          settingsVersion: policy?.version ?? 0,
          job: { sourceId: job.sourceId, title: job.title, company: job.company, url: job.url },
          resume,
          questions,
          exceptions: { required: true, approved: false, reasons: EXCEPTIONS },
          simulation: null,
        };
        const row = await tx.applicationPreparation.create({
          data: {
            userId,
            requestId: input.requestId,
            requestDigest: digest,
            ingestionRunId: run.id,
            sourceId: job.sourceId,
            url: job.url,
            state: toInputJson(state),
            events: {
              create: { userId, revision: 1, kind: "prepared", snapshot: toInputJson(state) },
            },
          },
        });
        return this.view(row, tx);
      },
      { timeout: 30_000 },
    );
  }
  async review(
    userId: string,
    tokenId: string,
    id: string,
    input: z.infer<typeof reviewPreparationSchema>,
  ) {
    await requireReviewSession(this.prisma, userId, tokenId);
    const prior = await this.owned(this.prisma, userId, id);
    if (prior.revision !== input.expectedRevision)
      throw conflict("Preparation changed; reload before reviewing.");
    const previousState = preparationStateSchema.parse(prior.state);
    assertFixtureUrl(previousState.job.url);
    const questions = await this.questions(userId, previousState.job);
    return this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx, userId, tokenId);
        const row = await this.owned(tx, userId, id);
        if (row.status === "simulated") throw conflict("Simulated preparations are immutable.");
        if (row.revision !== input.expectedRevision)
          throw conflict("Preparation changed; reload before reviewing.");
        const policy = await tx.autoApplyPolicy.findUnique({ where: { userId } });
        const settings = policyPreferences(policy);
        const resume = await selectResume(
          tx,
          userId,
          settings,
          previousState.job.title,
          previousState.resume?.id,
        );
        const versionUnchanged =
          previousState.settingsVersion === (policy?.version ?? 0) &&
          previousState.resume?.id === resume?.id &&
          previousState.resume?.version === resume?.version &&
          previousState.resume?.reviewRevision === resume?.reviewRevision;
        const state: State = {
          ...previousState,
          settingsVersion: policy?.version ?? 0,
          resume,
          questions,
          exceptions: {
            ...previousState.exceptions,
            approved:
              input.approveExceptions || (versionUnchanged && previousState.exceptions.approved),
          },
        };
        const revision = row.revision + 1;
        const updated = await tx.applicationPreparation.update({
          where: { id },
          data: {
            revision,
            status: this.ready(state) ? "ready" : "review",
            state: toInputJson(state),
            events: {
              create: { userId, revision, kind: "reviewed", snapshot: toInputJson(state) },
            },
          },
        });
        return this.view(updated, tx);
      },
      { timeout: 30_000 },
    );
  }
  async simulate(userId: string, tokenId: string, id: string, expectedRevision: number) {
    await requireReviewSession(this.prisma, userId, tokenId);
    return this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx, userId, tokenId);
        const row = await this.owned(tx, userId, id);
        if (row.status === "simulated") return this.view(row, tx);
        if (row.revision !== expectedRevision)
          throw conflict("Preparation changed; reload before simulating.");
        const state = preparationStateSchema.parse(row.state);
        assertFixtureUrl(state.job.url);
        if (!this.ready(state))
          throw forbidden("Approve the resume, required answers, and simulation exceptions first.");
        const freshQuestions = await this.questions(userId, state.job, tx);
        if (JSON.stringify(freshQuestions) !== JSON.stringify(state.questions))
          throw conflict(
            "Approved answers changed or expired; refresh questions and review again.",
          );
        const policy = await tx.autoApplyPolicy.findUnique({ where: { userId } });
        if ((policy?.version ?? 0) !== state.settingsVersion)
          throw conflict("Settings changed; review preparation again.");
        const settings = policyPreferences(policy);
        if (!state.resume) throw forbidden("Approved resume required.");
        await tx.$queryRaw`SELECT id FROM resumes WHERE id = ${state.resume.id} AND user_id = ${userId} FOR UPDATE`;
        const currentResume = await selectResume(
          tx,
          userId,
          { ...settings, resumeSelection: "fixed", fixedResumeId: state.resume.id },
          state.job.title,
        );
        if (
          !currentResume ||
          currentResume.version !== state.resume.version ||
          currentResume.reviewRevision !== state.resume.reviewRevision
        )
          throw conflict("Resume changed or approval was revoked; review again.");
        for (const question of state.questions) {
          if (question.status !== "approved" || !question.entryId) continue;
          await tx.$queryRaw`SELECT id FROM answer_entries WHERE id = ${question.entryId} AND user_id = ${userId} FOR UPDATE`;
          const entry = await tx.answerEntry.findFirst({
            where: {
              id: question.entryId,
              userId,
              version: question.entryVersion ?? -1,
              status: "approved",
              approvedAt: { lte: new Date() },
              reviewDueAt: { gt: new Date() },
            },
          });
          if (!entry)
            throw conflict("Answer approval changed; refresh questions before simulating.");
        }
        const now = new Date();
        const quota = await readQuota(tx, userId, settings, now);
        if (quota.remainingSimulation < 1) throw forbidden("Daily DRY_RUN quota reached.");
        const duplicate = await tx.dryRunReservation.findFirst({
          where: {
            userId,
            createdAt: { gte: new Date(now.getTime() - 86_400_000) },
            OR: [{ sourceId: row.sourceId }, { url: row.url }],
          },
        });
        const historical = await tx.application.findFirst({
          where: { userId, url: row.url },
          select: { id: true },
        });
        if (duplicate || historical)
          throw conflict("A prior application or dry-run reservation already exists.");
        const simulation = simulateFixture(
          row.url,
          state.questions.map((question) => ({
            id: question.id,
            approved: question.status === "approved",
            required: question.required,
          })),
        );
        const revision = row.revision + 1;
        const snapshot = { ...state, simulation };
        const day = quotaDay(now, settings.timeZone);
        if (Date.now() >= day.resetsAt.getTime())
          throw conflict("Quota day changed; retry after refreshing.");
        const updated = await tx.applicationPreparation.update({
          where: { id },
          data: {
            revision,
            status: "simulated",
            simulatedAt: now,
            state: toInputJson(snapshot),
            events: {
              create: { userId, revision, kind: "simulated", snapshot: toInputJson(snapshot) },
            },
          },
        });
        await this.answerHistory.capture(tx, userId, id, state, now);
        if (Date.now() >= day.resetsAt.getTime())
          throw conflict("Quota day changed while recording evidence; refresh and retry.");
        return this.view(updated, tx);
      },
      { timeout: 30_000 },
    );
  }
}
