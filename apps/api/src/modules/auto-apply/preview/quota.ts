import type { AutoApplyPreferences } from "@jobpilot/contracts/auto-apply";
import type { Prisma } from "@/generated/prisma/client";
import { quotaDay } from "./day-window";

export async function readQuota(
  tx: Prisma.TransactionClient,
  userId: string,
  settings: AutoApplyPreferences,
  now: Date,
) {
  const day = quotaDay(now, settings.timeZone);
  const where = { userId, appliedAt: { gte: day.startsAt, lt: day.resetsAt } };
  const [recordedApplications, dryRunReservations] = await Promise.all([
    tx.application.count({ where }),
    tx.dryRunReservation.count({
      where: { userId, createdAt: { gte: day.startsAt, lt: day.resetsAt } },
    }),
  ]);
  return {
    ...day,
    cap: settings.maxDailyApplications,
    recordedApplications,
    dryRunReservations,
    remainingActual: Math.max(0, settings.maxDailyApplications - recordedApplications),
    remainingSimulation: Math.max(
      0,
      settings.maxDailyApplications - recordedApplications - dryRunReservations,
    ),
  };
}
