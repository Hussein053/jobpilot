import { forbidden } from "@/common/errors";
import type { PrismaClient } from "@/generated/prisma/client";

export async function requireReviewSession(
  db: Pick<PrismaClient, "authToken">,
  userId: string,
  tokenId: string,
) {
  const session = await db.authToken.findFirst({
    where: {
      id: tokenId,
      userId,
      kind: "session",
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (!session) throw forbidden("Approval decisions require a current browser session.");
}
