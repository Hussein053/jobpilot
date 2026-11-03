import { createHash } from "node:crypto";
import { inject, injectable } from "@needle-di/core";
import type { z } from "zod/v4";
import { badRequest, unauthorized, unprocessable } from "@/common/errors";
import { PrismaClient } from "@/generated/prisma/client";
import { readBoundedBody } from "@/modules/ingestion/bounded-body";
import { signedHeaders, verifySignedMessage } from "@/modules/ingestion/signature";

@injectable()
export class DiscoveryRequestService {
  constructor(private readonly prisma: PrismaClient = inject(PrismaClient)) {}
  async read<T extends z.ZodType>(request: Request, action: string, schema: T, limit = 4096) {
    const url = new URL(request.url);
    if (
      request.method !== "POST" ||
      url.search ||
      url.hash ||
      url.pathname !== `/api/integrations/n8n/search/${action}`
    )
      throw badRequest("Invalid discovery operation");
    const headers = signedHeaders(request.headers);
    const integration = await this.prisma.ingestionIntegration.findUnique({
      where: { id: headers.integrationId },
    });
    if (!integration?.active) throw unauthorized("Discovery identity is inactive");
    const bytes = await readBoundedBody(request, limit);
    const digest = createHash("sha256").update(bytes).digest("hex");
    verifySignedMessage(
      `jobpilot-discovery-v1\nPOST\n${url.pathname}\n${headers.integrationId}\n${headers.timestamp}\n${digest}`,
      headers.signature,
      integration.publicKeyPem,
    );
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw badRequest("Malformed discovery JSON");
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw unprocessable("Invalid discovery request");
    return { integrationId: integration.id, input: parsed.data as z.output<T>, bytes };
  }
}
