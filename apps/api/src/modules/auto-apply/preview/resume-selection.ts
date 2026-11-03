import type { AutoApplyPreferences } from "@jobpilot/contracts/auto-apply";
import { resumeDataSchema } from "@jobpilot/contracts/resume";
import { resumePath } from "@/common/storage/storage";
import type { Prisma } from "@/generated/prisma/client";

export async function selectResume(
  tx: Prisma.TransactionClient,
  userId: string,
  settings: AutoApplyPreferences,
  jobTitle: string,
  manualId?: string,
) {
  let selectedId: string | undefined;
  if (settings.resumeSelection === "fixed") selectedId = settings.fixedResumeId ?? undefined;
  if (settings.resumeSelection === "manual") {
    if (!manualId) return null;
    selectedId = manualId;
  }
  const resumes = await tx.resume.findMany({
    where: {
      userId,
      active: true,
      approvedAt: { not: null },
      ...(selectedId && { id: selectedId }),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
  const terms = new Set(
    jobTitle
      .normalize("NFC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [],
  );
  const available = [];
  for (const resume of resumes) {
    if (
      resume.approvedVersion !== resume.version ||
      !resume.approvedAt ||
      resume.approvedAt > new Date()
    )
      continue;
    const content = resumeDataSchema.safeParse(resume.content);
    const source = resume.sourceFilename
      ? await Bun.file(resumePath(resume.sourceFilename)).exists()
      : false;
    if (!content.success && !source) continue;
    const text =
      `${resume.label} ${content.success ? JSON.stringify(content.data) : ""}`.toLowerCase();
    const tokens = new Set(text.match(/[\p{L}\p{N}]+/gu) ?? []);
    const overlap = [...terms].filter((term) => tokens.has(term)).length;
    available.push({ resume, overlap });
  }
  available.sort((a, b) => b.overlap - a.overlap);
  const chosen = available[0]?.resume;
  return chosen
    ? {
        id: chosen.id,
        version: chosen.version,
        reviewRevision: chosen.reviewRevision,
        label: chosen.label,
      }
    : null;
}
