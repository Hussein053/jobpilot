import type { PrismaClient, Resume } from "@/generated/prisma/client";
import { ResumeReviewService } from "./resume-review.service";

export function reviewFixture() {
  const owner = crypto.randomUUID();
  const token = crypto.randomUUID();
  const row: Resume = {
    id: crypto.randomUUID(),
    userId: owner,
    label: "Synthetic resume",
    version: 1,
    active: true,
    reviewRevision: 0,
    approvedAt: null,
    approvedVersion: null,
    content: { basics: { name: "Synthetic Applicant" } },
    sourceFilename: "fixture.pdf",
    sourceMimeType: "application/pdf",
    sourceSizeBytes: 20,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  let sessionAllowed = true;
  const events: Record<string, unknown>[] = [];
  const db = {
    authToken: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        sessionAllowed && where.id === token && where.userId === owner ? { id: token } : null,
    },
    resume: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        where.id === row.id && where.userId === row.userId ? { ...row } : null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { version: number; reviewRevision: number };
        data: {
          reviewRevision: { increment: number };
          active: boolean;
          approvedAt: Date | null;
          approvedVersion: number | null;
        };
      }) => {
        if (row.version !== where.version || row.reviewRevision !== where.reviewRevision)
          return { count: 0 };
        Object.assign(row, { ...data, reviewRevision: row.reviewRevision + 1 });
        return { count: 1 };
      },
    },
    resumeReviewEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const event = { ...data, id: crypto.randomUUID(), createdAt: new Date() };
        events.push(event);
        return event;
      },
      findMany: async ({ where }: { where: { userId: string; resumeId: string } }) =>
        events.filter((e) => e.userId === where.userId && e.resumeId === where.resumeId).reverse(),
      count: async ({ where }: { where: { userId: string; resumeId: string } }) =>
        events.filter((e) => e.userId === where.userId && e.resumeId === where.resumeId).length,
    },
    async $transaction<T>(work: (client: unknown) => Promise<T>) {
      return work(db);
    },
  };
  return {
    owner,
    token,
    row,
    events,
    service: new ResumeReviewService(db as unknown as PrismaClient),
    denySession: () => {
      sessionAllowed = false;
    },
  };
}
