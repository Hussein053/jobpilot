import type { TaskList } from "@jobpilot/contracts/pilot";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { errorMiddleware } from "@/common/middleware/error.middleware";
import type { PrismaClient } from "@/generated/prisma/client";
import { ApplicationService } from "@/modules/application/application.service";
import { AuthTokenService } from "@/modules/auth/auth-token.service";
import { CampaignJobService } from "@/modules/campaign/jobs/job.service";
import { makeBoards } from "@/modules/job-board/job-board.fake";
import type { JobListingPublisher } from "@/modules/job-listing/publishing/job-listing.publisher";
import type { PilotJournalService } from "@/modules/pilot/journal.service";
import { RunService } from "@/modules/pilot/tasks/run.service";
import { httpErrorResponses } from "@/types/response";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const campaignId = "33333333-3333-4333-8333-333333333333";
const applicationId = "44444444-4444-4444-8444-444444444444";
const now = new Date();
const history = {
  id: applicationId,
  userId: owner,
  url: "https://example.test/jobs/1",
  title: "Engineer",
  company: "Acme",
  location: "US",
  boardId: null,
  board: null,
  source: "auto_apply",
  appliedAt: now,
  status: "applied",
  rejectedAt: null,
  matchScore: 90,
  matchReason: "Historical fit",
  failReason: null,
  campaignId,
  jobId: null,
  resumeId: null,
  resumeVariantId: null,
  events: [],
  resume: null,
  resumeVariantUsed: null,
  resumeVariants: [],
  coverLetters: [],
  emailMessages: [],
  contacts: [],
  job: null,
};
const snapshot: TaskList = {
  version: crypto.randomUUID(),
  builtAt: now,
  expiresAt: new Date(now.getTime() + 60_000),
  tasks: [
    {
      id: "job.apply:fixture",
      taskType: "job.apply",
      priority: 100,
      title: "Apply fixture",
      subjectType: "job",
      subjectId: "fixture",
      payload: {
        campaignId,
        jobKey: "j1",
        jobTitle: "Engineer",
        url: history.url,
        board: null,
        brief: null,
        matchScore: 90,
      },
    },
  ],
  counts: { openQuestions: 0, activeRuns: 0, approvedJobs: 1, appliedToday: 0 },
  budget: {
    dailyApplyCap: 50,
    appliedToday: 0,
    capReached: false,
    dailyNetworkingCap: 0,
    networkingSentToday: 0,
    resetsAt: now,
  },
  emptyReason: null,
  sleepSeconds: 15,
  nextWakeAt: now,
};
let jobStatus = "approved";
const job = () => ({
  ...history,
  id: "55555555-5555-4555-8555-555555555555",
  key: "j1",
  status: jobStatus,
  salary: null,
  type: null,
  retryNotes: null,
  skipReason: null,
  description: null,
  brief: null,
  createdAt: now,
  updatedAt: now,
  campaign: { source: "auto_apply" },
});
const writes = () => {
  throw new Error("Unexpected fixture write");
};
const tx = {
  pilotState: { updateManyAndReturn: async () => [{ taskListSnapshot: snapshot }] },
  pilotRun: { findFirst: async () => null, create: mock(writes) },
  job: { findFirst: writes, updateManyAndReturn: writes },
};
const db = {
  job: {
    findFirst: mock(async () => job()),
    create: mock(writes),
    updateMany: mock(writes),
    groupBy: mock(async () => [
      { campaignId, status: "applied", _count: { _all: 1, matchScore: 1 } },
    ]),
  },
  application: {
    findFirst: mock(async (args: { where: { userId: string; id: string } }) =>
      args.where.userId === owner && args.where.id === applicationId ? history : null,
    ),
    findMany: mock(async () => [history]),
    count: mock(async () => 1),
    findUnique: mock(async () => history),
    upsert: mock(writes),
  },
  networkingMessage: { groupBy: mock(async () => []) },
  pilotRun: { create: mock(writes) },
  $transaction: mock(async (work: (client: unknown) => unknown) => work(tx)),
};
const fakeDb = db as unknown as PrismaClient;
const campaignService = new CampaignJobService(
  fakeDb,
  { publishInBackground: () => undefined } as unknown as JobListingPublisher,
  makeBoards(),
);
const applicationService = new ApplicationService(fakeDb);
const runs = new RunService(fakeDb, {} as PilotJournalService);
const resolve = container.get.bind(container);
const services = spyOn(container, "get").mockImplementation((key) => {
  if (key === CampaignJobService) return campaignService;
  if (key === ApplicationService) return applicationService;
  if (key === RunService) return runs;
  return resolve(key);
});
const { campaignJobController } = await import("@/modules/campaign/jobs/job.controller");
const { applicationController } = await import("@/modules/application/application.controller");
const { pilotTasksController } = await import("@/modules/pilot/tasks/tasks.controller");
services.mockRestore();
const app = new Elysia()
  .use(errorMiddleware)
  .guard({ as: "scoped", response: httpErrorResponses })
  .group("/api", (api) =>
    api.use(campaignJobController).use(applicationController).use(pilotTasksController),
  );
let authentication: ReturnType<typeof spyOn<typeof container, "get">> | undefined;

beforeEach(() => {
  jobStatus = "approved";
  for (const model of [db.job, db.application, db.networkingMessage, db.pilotRun]) {
    for (const operation of Object.values(model)) operation.mockClear();
  }
  db.$transaction.mockClear();
  tx.pilotRun.create.mockClear();
  authentication = spyOn(container, "get").mockImplementation((key) =>
    key === AuthTokenService
      ? {
          verify: async (token: string) =>
            [owner, other].includes(token)
              ? { id: token, email: "fixture@example.test", role: "USER", tokenId: token }
              : null,
        }
      : resolve(key),
  );
});

afterEach(() => authentication?.mockRestore());

function request(path: string, method = "GET", body?: unknown, user = owner) {
  return app.handle(
    new Request(`http://localhost/api${path}`, {
      method,
      headers: { authorization: `Bearer ${user}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

describe("production application routes under DRY_RUN", () => {
  it("blocks every campaign execution command and the Pilot application claim", async () => {
    const attempts: [string, string, unknown][] = [
      [
        `/campaigns/${campaignId}/jobs`,
        "POST",
        { key: "j1", title: "Engineer", company: "Acme", url: history.url, status: "applying" },
      ],
      [`/campaigns/${campaignId}/jobs/j1`, "PATCH", { status: "applying" }],
      [
        `/campaigns/${campaignId}/jobs/j1/result`,
        "POST",
        { outcome: "applied", appliedAt: now.toISOString() },
      ],
      ["/pilot/runs", "POST", { taskListVersion: snapshot.version, taskId: snapshot.tasks[0].id }],
    ];
    for (const [path, method, body] of attempts) {
      const response = await request(path, method, body);
      expect({ path, status: response.status }).toEqual({ path, status: 403 });
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
    }
    expect(db.application.upsert).not.toHaveBeenCalled();
    expect(db.job.updateMany).not.toHaveBeenCalled();
    expect(db.job.create).not.toHaveBeenCalled();
    expect(db.pilotRun.create).not.toHaveBeenCalled();
    expect(tx.pilotRun.create).not.toHaveBeenCalled();
  });

  it("keeps historical application lists and detail readable through real controllers", async () => {
    const list = await request("/applied");
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ items: [{ id: applicationId, status: "applied" }] });
    expect(db.application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: owner } }),
    );
    const detail = await request(`/applied/${applicationId}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ id: applicationId, events: [], coverLetters: [] });
  });

  it("retains per-user isolation for historical application detail", async () => {
    const response = await request(`/applied/${applicationId}`, "GET", undefined, other);
    expect(response.status).toBe(404);
  });

  it("returns a historical result repeatedly without creating applications or events", async () => {
    jobStatus = "applied";
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request(`/campaigns/${campaignId}/jobs/j1/result`, "POST", {
        outcome: "applied",
        appliedAt: now.toISOString(),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        application: { id: applicationId },
        summary: { applied: 1 },
      });
    }
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.application.upsert).not.toHaveBeenCalled();
  });
});
