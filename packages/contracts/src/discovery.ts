export const MAX_DISCOVERY_RETRY_AFTER = 604800;

import { z } from "zod/v4";

export const DISCOVERY_TRIGGERS = ["scheduled", "manual"] as const;
export const DISCOVERY_TASK_STATES = ["planned", "fetch_started", "frozen", "quarantined"] as const;
export const DISCOVERY_DELIVERY_STATES = [
  "pending",
  "in_flight",
  "retry_wait",
  "stored",
  "quarantined",
  "auth_stopped",
] as const;
export const DISCOVERY_IDENTITY_KINDS = ["source", "url"] as const;
export const DISCOVERY_FAILURES = [
  "provider_uncertain",
  "mapping_invalid",
  "identity_conflict",
  "transport_error",
  "rate_limited",
  "remote_error",
  "bad_payload",
  "auth_failed",
  "body_conflict",
  "invalid_receipt",
  "attempt_limit",
] as const;
export const DISCOVERY_EVENTS = [
  "claimed",
  "provider_started",
  "provider_failed",
  "frozen",
  "delivery_leased",
  "stored",
  "retry_wait",
  "quarantined",
  "auth_stopped",
] as const;
export const discoveryClaimSchema = z.strictObject({
  requestId: z.uuid(),
  trigger: z.enum(DISCOVERY_TRIGGERS),
});
export const discoveryStartSchema = z.strictObject({ taskId: z.uuid(), requestId: z.uuid() });
export const discoveryFreezeSchema = z.strictObject({
  taskId: z.uuid(),
  requestId: z.uuid(),
  providerResponse: z.unknown(),
});
export const discoveryFailSchema = z.strictObject({
  taskId: z.uuid(),
  requestId: z.uuid(),
  reason: z.literal("provider_uncertain"),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  retryAfterSeconds: z.number().int().min(0).max(MAX_DISCOVERY_RETRY_AFTER).nullable(),
});
export const discoveryLeaseSchema = z.strictObject({ deliveryId: z.uuid(), requestId: z.uuid() });
export const discoveryReportSchema = z.strictObject({
  deliveryId: z.uuid(),
  leaseId: z.uuid(),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  receiptValid: z.boolean(),
  retryAfterSeconds: z.number().int().min(0).max(MAX_DISCOVERY_RETRY_AFTER).nullable(),
});
export const providerQuerySchema = z.strictObject({
  query: z.string().min(1).max(1000),
  country: z.literal("us"),
  numPages: z.literal(1),
  remoteOnly: z.boolean(),
});
const discoveryRuntimeSchema = z.object({
  submissionMode: z.literal("DRY_RUN"),
  liveSubmissionsEnabled: z.literal(false),
  unrestrictedAgentsEnabled: z.literal(false),
});
export const discoveryClaimResponseSchema = z.object({
  runtime: discoveryRuntimeSchema,
  runId: z.uuid().nullable(),
  duplicate: z.boolean(),
  status: z.enum(["claimed", "not_due", "budget_exhausted", "provider_backoff"]),
  taskIds: z.array(z.uuid()).max(3),
});
export const discoveryWorkResponseSchema = z.object({
  runtime: discoveryRuntimeSchema,
  taskIds: z.array(z.uuid()).max(3),
  deliveryIds: z.array(z.uuid()).max(5),
});
export const discoveryStartResponseSchema = z.object({
  runtime: discoveryRuntimeSchema,
  allowed: z.boolean(),
  taskId: z.uuid(),
  state: z.enum(DISCOVERY_TASK_STATES),
  query: providerQuerySchema.nullable(),
});
export const discoveryFreezeResponseSchema = z.object({
  runtime: discoveryRuntimeSchema,
  taskId: z.uuid(),
  state: z.enum(DISCOVERY_TASK_STATES),
  deliveryIds: z.array(z.uuid()).max(1000),
  issueCount: z.number().int().nonnegative(),
});
export const discoveryLeaseResponseSchema = z.object({
  runtime: discoveryRuntimeSchema,
  allowed: z.boolean(),
  deliveryId: z.uuid(),
  state: z.enum(DISCOVERY_DELIVERY_STATES),
  leaseId: z.uuid().nullable(),
  runId: z.uuid(),
  body: z.string().nullable(),
});
export const discoveryReportResponseSchema = z.object({
  runtime: discoveryRuntimeSchema,
  deliveryId: z.uuid(),
  state: z.enum(DISCOVERY_DELIVERY_STATES),
  failure: z.enum(DISCOVERY_FAILURES).nullable(),
});
export const storedIngestionReceiptSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  duplicate: z.boolean(),
  disposition: z.literal("stored_only"),
  runtime: discoveryRuntimeSchema,
});
