import {
  discoveryClaimResponseSchema,
  discoveryClaimSchema,
  discoveryFreezeResponseSchema,
  discoveryLeaseResponseSchema,
  discoveryReportResponseSchema,
  discoveryStartResponseSchema,
  discoveryWorkResponseSchema,
  providerQuerySchema,
  storedIngestionReceiptSchema,
} from "@jobpilot/contracts/discovery";
import { ingestionBatchSchema } from "@jobpilot/contracts/ingestion";
import type { z } from "zod/v4";
import { readBoundedBody } from "@/modules/ingestion/bounded-body";
import {
  boundedResponseJson,
  type RelayCapabilities,
  RelayFault,
  relayConfigSchema,
  retryAfter,
  signedRelayHeaders,
} from "./security";

export class DiscoveryRelay {
  private readonly config;
  constructor(
    config: z.input<typeof relayConfigSchema>,
    private readonly capabilities?: RelayCapabilities,
  ) {
    this.config = Object.freeze(relayConfigSchema.parse(config));
  }
  private async call<T extends z.ZodType>(
    action: string,
    input: unknown,
    schema: T,
  ): Promise<z.output<T>> {
    if (!this.capabilities) throw new RelayFault("inactive");
    const path = `/api/integrations/n8n/search/${action}`;
    const body = JSON.stringify(input);
    if (Buffer.byteLength(body) > (action === "freeze" ? 1048576 : 4096))
      throw new RelayFault("invalid_request");
    const headers = await signedRelayHeaders(this.config, this.capabilities, path, body);
    let response: Response;
    try {
      response = await this.capabilities.jobpilotFetch(new URL(path, this.config.jobpilotOrigin), {
        method: "POST",
        body,
        headers,
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new RelayFault("transport_error");
    }
    if (response.status === 401 || response.status === 403) throw new RelayFault("auth_stopped");
    if (!response.ok) throw new RelayFault("transport_error");
    const parsed = schema.safeParse(await boundedResponseJson(response, 2097152));
    if (!parsed.success) throw new RelayFault("unsafe_response");
    return parsed.data as z.output<T>;
  }
  private async fetchTask(taskId: string) {
    if (!this.capabilities) throw new RelayFault("inactive");
    const requestId = crypto.randomUUID();
    const grant = await this.call("start", { taskId, requestId }, discoveryStartResponseSchema);
    if (!grant.allowed)
      return {
        deliveryIds: [],
        issues: 0,
        failed: grant.state === "quarantined",
        incomplete: grant.state !== "frozen",
      };
    if (!grant.query) throw new RelayFault("unsafe_response");
    const query = providerQuerySchema.parse(grant.query);
    const url = new URL("https://jsearch.p.rapidapi.com/search-v2");
    url.searchParams.set("query", query.query);
    url.searchParams.set("country", query.country);
    url.searchParams.set("num_pages", "1");
    if (query.remoteOnly) url.searchParams.set("work_from_home", "true");
    let providerResponse: unknown;
    let response: Response | undefined;
    try {
      response = await this.capabilities.providerFetch(url, {
        method: "GET",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error();
      providerResponse = await boundedResponseJson(response, 1048064);
    } catch {
      await this.call(
        "fail",
        {
          taskId,
          requestId,
          reason: "provider_uncertain",
          httpStatus: response?.status ?? null,
          retryAfterSeconds: response ? retryAfter(response) : null,
        },
        discoveryFreezeResponseSchema,
      );
      return { deliveryIds: [], issues: 0, failed: true, incomplete: true };
    }
    const frozen = await this.call(
      "freeze",
      { taskId, requestId, providerResponse },
      discoveryFreezeResponseSchema,
    );
    return {
      deliveryIds: frozen.deliveryIds,
      issues: frozen.issueCount,
      failed: frozen.state === "quarantined",
      incomplete: frozen.state !== "frozen",
    };
  }
  private async deliver(deliveryId: string) {
    if (!this.capabilities) throw new RelayFault("inactive");
    const lease = await this.call(
      "lease",
      { deliveryId, requestId: crypto.randomUUID() },
      discoveryLeaseResponseSchema,
    );
    if (!lease.allowed || !lease.leaseId || !lease.body)
      return { stored: lease.state === "stored", stopped: lease.state === "auth_stopped" };
    let batch: z.infer<typeof ingestionBatchSchema>;
    try {
      batch = ingestionBatchSchema.parse(JSON.parse(lease.body));
    } catch {
      throw new RelayFault("unsafe_response");
    }
    if (batch.runId !== lease.runId || Buffer.byteLength(lease.body) > 65536)
      throw new RelayFault("unsafe_response");
    const path = "/api/integrations/n8n/ingest";
    const headers = await signedRelayHeaders(this.config, this.capabilities, path, lease.body);
    let httpStatus: number | null = null;
    let receiptValid = false;
    let delay: number | null = null;
    try {
      const response = await this.capabilities.jobpilotFetch(
        new URL(path, this.config.jobpilotOrigin),
        {
          method: "POST",
          headers,
          body: lease.body,
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        },
      );
      httpStatus = response.status;
      delay = retryAfter(response);
      if (response.ok) {
        const receipt = storedIngestionReceiptSchema.safeParse(
          await boundedResponseJson(response, 8192),
        );
        receiptValid = receipt.success && receipt.data.runId === lease.runId;
      }
    } catch {
      /* A lost response is reconciled against the receiver's durable inbox. */
    }
    const report = await this.call(
      "report",
      { deliveryId, leaseId: lease.leaseId, httpStatus, receiptValid, retryAfterSeconds: delay },
      discoveryReportResponseSchema,
    );
    return { stored: report.state === "stored", stopped: report.state === "auth_stopped" };
  }
  async handle(request: Request) {
    const json = (body: unknown, status = 200) =>
      Response.json(body, { status, headers: { "cache-control": "no-store" } });
    try {
      if (!this.config.enabled || !this.capabilities) throw new RelayFault("inactive");
      const url = new URL(request.url);
      if (request.method !== "POST" || url.pathname !== "/trigger" || url.search || url.hash)
        throw new RelayFault("invalid_request");
      if ((await this.capabilities.authenticate(request)) !== this.config.expectedSubject)
        throw new RelayFault("unauthorized");
      let raw: unknown;
      try {
        raw = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedBody(request, 4096)),
        );
      } catch {
        throw new RelayFault("invalid_request");
      }
      const parsed = discoveryClaimSchema.safeParse(raw);
      if (!parsed.success) throw new RelayFault("invalid_request");
      const work = await this.call("work", {}, discoveryWorkResponseSchema);
      const claim = await this.call("claim", parsed.data, discoveryClaimResponseSchema);
      const deliveryIds = new Set(work.deliveryIds);
      const taskIds = [...new Set([...work.taskIds, ...claim.taskIds])];
      let issueCount = 0;
      let failed = false;
      let incomplete = taskIds.length > 3;
      for (const taskId of taskIds.slice(0, 3)) {
        const fetched = await this.fetchTask(taskId);
        for (const id of fetched.deliveryIds) deliveryIds.add(id);
        issueCount += fetched.issues;
        failed ||= fetched.failed;
        incomplete ||= fetched.incomplete;
        if (fetched.failed) break;
      }
      let storedBatches = 0;
      for (const id of [...deliveryIds].slice(0, 5)) {
        const delivery = await this.deliver(id);
        if (delivery.stopped) throw new RelayFault("auth_stopped");
        if (delivery.stored) storedBatches++;
      }
      return json({
        status: failed || incomplete || deliveryIds.size > storedBatches ? "partial" : "complete",
        runId: claim.runId,
        storedBatches,
        issueCount,
        claimStatus: claim.status,
        submissionMode: "DRY_RUN",
      });
    } catch (error) {
      const reason = error instanceof RelayFault ? error.reason : "transport_error";
      let status = 502;
      if (reason === "inactive") status = 503;
      if (reason === "unauthorized") status = 401;
      if (reason === "invalid_request") status = 422;
      return json({ status: "stopped", reason, submissionMode: "DRY_RUN" }, status);
    }
  }
}
