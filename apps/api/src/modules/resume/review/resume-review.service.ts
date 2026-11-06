import { type PaginationQuery, pageSlice, paginate } from "@jobpilot/contracts/pagination";
import { resumeDataSchema } from "@jobpilot/contracts/resume";
import type { reviewResumeSchema } from "@jobpilot/contracts/resume-review";
import { inject, injectable } from "@needle-di/core";
import type { z } from "zod/v4";
import { requireReviewSession } from "@/common/auth/require-review-session";
import { badRequest, conflict, notFound } from "@/common/errors";
import { resumePath } from "@/common/storage/storage";
import { PrismaClient } from "@/generated/prisma/client";

@injectable()
export class ResumeReviewService {
  constructor(private readonly prisma: PrismaClient = inject(PrismaClient)) {}

  async review(
    userId: string,
    tokenId: string,
    id: string,
    input: z.infer<typeof reviewResumeSchema>,
  ) {
    await requireReviewSession(this.prisma, userId, tokenId);
    return this.prisma.$transaction(async (tx) => {
      const resume = await tx.resume.findFirst({ where: { id, userId } });
      if (!resume) throw notFound("Resume not found");
      if (
        resume.version !== input.expectedVersion ||
        resume.reviewRevision !== input.expectedReviewRevision
      ) {
        throw conflict("Resume or review changed. Reload before reviewing again.", "STALE_WRITE");
      }
      if (input.action === "approve") {
        const structured = resumeDataSchema.safeParse(resume.content).success;
        const sourceExists = resume.sourceFilename
          ? await Bun.file(resumePath(resume.sourceFilename)).exists()
          : false;
        if (!resume.active || (!structured && !sourceExists)) {
          throw badRequest(
            "Review an active resume containing valid content or an available source file.",
          );
        }
      }
      const data = {
        reviewRevision: { increment: 1 },
        approvedAt: input.action === "approve" ? new Date() : null,
        approvedVersion: input.action === "approve" ? resume.version : null,
        active: resume.active,
      };
      if (input.action === "activate") data.active = true;
      if (input.action === "deactivate") data.active = false;
      const changed = await tx.resume.updateMany({
        where: {
          id,
          userId,
          version: input.expectedVersion,
          reviewRevision: input.expectedReviewRevision,
        },
        data,
      });
      if (changed.count !== 1)
        throw conflict("Resume changed. Reload before reviewing again.", "STALE_WRITE");
      await tx.resumeReviewEvent.create({
        data: {
          userId,
          resumeId: id,
          actorTokenId: tokenId,
          action: input.action,
          resumeVersion: resume.version,
          reviewRevision: resume.reviewRevision + 1,
        },
      });
      return {
        id,
        version: resume.version,
        reviewRevision: resume.reviewRevision + 1,
        active: data.active,
        approvedAt: data.approvedAt,
        approvedVersion: data.approvedVersion,
      };
    });
  }

  async history(userId: string, id: string, query: PaginationQuery) {
    const where = { userId, resumeId: id };
    const [rows, total] = await Promise.all([
      this.prisma.resumeReviewEvent.findMany({
        where,
        ...pageSlice(query),
        orderBy: { reviewRevision: "desc" },
        select: {
          id: true,
          action: true,
          resumeVersion: true,
          reviewRevision: true,
          createdAt: true,
        },
      }),
      this.prisma.resumeReviewEvent.count({ where }),
    ]);
    return paginate(rows, query, total);
  }
}
