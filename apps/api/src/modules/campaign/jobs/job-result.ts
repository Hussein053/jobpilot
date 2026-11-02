import type { CampaignJobResultInput } from "@jobpilot/contracts/campaign";
import { findOwned } from "@/common/errors";
import type { PrismaClient } from "@/generated/prisma/client";
import { assertApplicationExecutionAllowed } from "@/modules/execution/execution-policy";
import { isTerminalJob, persistJobResult } from "./job-result.store";
import { JOB_INCLUDE } from "./job-row";

/** The production entry point: only historical terminal replays may report applied. */
export async function writeJobResult(
  prisma: PrismaClient,
  userId: string,
  campaignId: string,
  key: string,
  data: CampaignJobResultInput,
) {
  const existing = await findOwned(
    (where) =>
      prisma.job.findFirst({
        where,
        include: { ...JOB_INCLUDE, campaign: { select: { source: true } } },
      }),
    { campaignId, key, campaign: { userId } },
    "Campaign job",
  );
  if (!isTerminalJob(existing.status) && data.outcome === "applied") {
    assertApplicationExecutionAllowed();
  }
  return persistJobResult(prisma, userId, existing, data);
}
