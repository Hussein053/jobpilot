import { generateKeyPairSync, sign } from "node:crypto";
import {
  type DISCOVERY_TASK_STATES,
  discoveryStartResponseSchema,
} from "@jobpilot/contracts/discovery";
import { DiscoveryRelay } from "./relay";
import type { RelayCapabilities } from "./security";
import { expect, test } from "bun:test";

const keys = generateKeyPairSync("ed25519");
const runtime = {
  submissionMode: "DRY_RUN",
  liveSubmissionsEnabled: false,
  unrestrictedAgentsEnabled: false,
};

function fixture(
  previousTasks: string[],
  claimedTasks: string[],
  deniedState?: (typeof DISCOVERY_TASK_STATES)[number],
) {
  const started: string[] = [];
  let providerCalls = 0;
  const runId = crypto.randomUUID();
  const capabilities: RelayCapabilities = {
    authenticate: async () => "fixture-relay",
    signer: { sign: async (message) => sign(null, message, keys.privateKey) },
    jobpilotFetch: async (input, init) => {
      const url = new URL(String(input));
      const body = JSON.parse(String(init?.body));
      if (url.pathname.endsWith("/work"))
        return Response.json({ runtime, taskIds: previousTasks, deliveryIds: [] });
      if (url.pathname.endsWith("/claim"))
        return Response.json({
          runtime,
          runId,
          duplicate: false,
          status: "claimed",
          taskIds: claimedTasks,
        });
      if (url.pathname.endsWith("/start")) {
        started.push(body.taskId);
        return Response.json({
          runtime,
          taskId: body.taskId,
          state: deniedState ?? "fetch_started",
          allowed: !deniedState,
          query: deniedState
            ? null
            : { query: "Program Manager", country: "us", numPages: 1, remoteOnly: false },
        });
      }
      if (url.pathname.endsWith("/freeze"))
        return Response.json({
          runtime,
          taskId: body.taskId,
          state: "frozen",
          deliveryIds: [],
          issueCount: 0,
        });
      throw new Error(`Unexpected relay operation: ${url.pathname}`);
    },
    providerFetch: async () => {
      providerCalls++;
      return Response.json({ status: "OK", data: { jobs: [] } });
    },
  };
  const relay = new DiscoveryRelay(
    {
      enabled: true,
      integrationId: crypto.randomUUID(),
      expectedSubject: "fixture-relay",
      publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      jobpilotOrigin: "https://jobpilot.example.test/",
    },
    capabilities,
  );
  return {
    runId,
    started,
    capabilities,
    providerCalls: () => providerCalls,
    trigger: () =>
      relay.handle(
        new Request("https://relay.example.test/trigger", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ requestId: crypto.randomUUID(), trigger: "scheduled" }),
        }),
      ),
  };
}

test("older queued tasks cannot make an unprocessed new claim report complete", async () => {
  const previousTasks = Array.from({ length: 3 }, () => crypto.randomUUID());
  const claimedTasks = Array.from({ length: 3 }, () => crypto.randomUUID());
  const f = fixture(previousTasks, claimedTasks);
  const response = await f.trigger();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "partial", runId: f.runId });
  expect(f.started).toEqual(previousTasks);
  expect(f.providerCalls()).toBe(3);
});

test.each(["planned", "fetch_started", "quarantined"] as const)(
  "a denied %s task is not reported complete",
  async (state) => {
    const f = fixture([], [crypto.randomUUID()], state);
    const response = await f.trigger();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "partial", runId: f.runId });
    expect(f.providerCalls()).toBe(0);
  },
);

test("an already frozen task remains an idempotent completed fetch", async () => {
  const f = fixture([], [crypto.randomUUID()], "frozen");
  const response = await f.trigger();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "complete", runId: f.runId });
  expect(f.providerCalls()).toBe(0);
});

test("all claimed tasks can complete within the bounded invocation", async () => {
  const tasks = Array.from({ length: 3 }, () => crypto.randomUUID());
  const f = fixture(tasks, tasks);
  const response = await f.trigger();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "complete", runId: f.runId });
  expect(f.started).toEqual(tasks);
  expect(f.providerCalls()).toBe(3);
});

test("an allowed grant without its verified query stops before fetching", async () => {
  const f = fixture([], [crypto.randomUUID()]);
  const transport = f.capabilities.jobpilotFetch;
  f.capabilities.jobpilotFetch = async (input, init) => {
    const response = await transport(input, init);
    if (String(input).endsWith("/start"))
      return Response.json({
        ...discoveryStartResponseSchema.parse(await response.json()),
        query: null,
      });
    return response;
  };
  const response = await f.trigger();
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ status: "stopped", reason: "unsafe_response" });
  expect(f.providerCalls()).toBe(0);
});
