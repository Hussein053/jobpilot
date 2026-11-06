import {
  bankEntryDefinitionSchema,
  type bankProvenanceSchema,
} from "@jobpilot/contracts/information-bank";
import { inject, injectable } from "@needle-di/core";
import type { z } from "zod/v4";
import { requireReviewSession } from "@/common/auth/require-review-session";
import { badRequest, notFound, prismaCode } from "@/common/errors";
import { PrismaClient } from "@/generated/prisma/client";
import { readContent } from "@/modules/resume/content";
import { InformationBankService } from "./information-bank.service";

@injectable()
export class InformationBankImportService {
  constructor(
    private readonly prisma: PrismaClient = inject(PrismaClient),
    private readonly bank: InformationBankService = inject(InformationBankService),
  ) {}
  async profile(userId: string, tokenId: string) {
    await requireReviewSession(this.prisma, userId, tokenId);
    const profile = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        contactEmail: true,
        phone: true,
        city: true,
        state: true,
        country: true,
      },
    });
    if (!profile) throw notFound("Profile not found");
    return this.importContact(
      userId,
      tokenId,
      { kind: "profile_draft", referenceId: userId, referenceVersion: null },
      {
        name: [profile.firstName, profile.lastName].filter(Boolean).join(" "),
        email: profile.contactEmail,
        phone: profile.phone,
        location: [profile.city, profile.state, profile.country].filter(Boolean).join(", "),
      },
    );
  }
  async resume(userId: string, tokenId: string, id: string) {
    await requireReviewSession(this.prisma, userId, tokenId);
    const resume = await this.prisma.resume.findFirst({ where: { id, userId } });
    if (!resume) throw notFound("Resume not found");
    if (!resume.content)
      throw badRequest(
        "Extract and review the structured resume before importing contact suggestions.",
      );
    return this.importContact(
      userId,
      tokenId,
      { kind: "resume_draft", referenceId: id, referenceVersion: resume.version },
      readContent(resume.content).basics,
    );
  }
  private async importContact(
    userId: string,
    tokenId: string,
    source: z.infer<typeof bankProvenanceSchema>,
    contact: { name?: string; email?: string | null; phone?: string | null; location?: string },
  ) {
    let created = 0;
    let skipped = 0;
    for (const [question, value] of [
      ["What is your full name?", contact.name],
      ["What is your contact email?", contact.email],
      ["What is your contact phone number?", contact.phone],
      ["Where are you currently located?", contact.location],
    ]) {
      if (!value?.trim()) continue;
      const parsed = bankEntryDefinitionSchema.safeParse({
        question,
        intent: "contact",
        category: "identity",
        scope: "global",
        scopeKey: null,
        answer: { kind: "text", value },
      });
      if (!parsed.success) {
        skipped++;
        continue;
      }
      try {
        await this.bank.create(userId, tokenId, parsed.data, source);
        created++;
      } catch (error) {
        if (prismaCode(error) !== "P2002") throw error;
        skipped++;
      }
    }
    return { created, skipped };
  }
}
