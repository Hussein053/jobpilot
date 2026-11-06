import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod/v4";
import { PrismaClient } from "../src/generated/prisma/client";
import { mapJSearch } from "../src/modules/ingestion/discovery/jsearch";

// An isolated fixture database is mandatory; this script never connects to an employer.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Set the isolated demo DATABASE_URL.");
const database = new URL(databaseUrl);
if (database.hostname !== "127.0.0.1" || database.pathname !== "/jobpilot_mvp_local")
  throw new Error("Demo requires the dedicated loopback jobpilot_mvp_local database.");
const api = "http://127.0.0.1:4101";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const idSchema = z.object({ id: z.uuid() });
const versionSchema = idSchema.extend({ version: z.number().int() });
let cookie = "";
async function request(path: string, body?: unknown, method = body ? "POST" : "GET") {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(value)}`);
  const session = response.headers.get("set-cookie");
  if (session) cookie = session.split(";")[0] ?? "";
  return value;
}
try {
  const email = `dry-run-${crypto.randomUUID().slice(0, 8)}@example.invalid`;
  const password = `Fixture!${crypto.randomUUID()}Aa9`;
  const account = z
    .object({ user: idSchema })
    .parse(await request("/api/auth/register", { email, password }));
  await request(
    "/api/user/",
    {
      firstName: "Synthetic",
      lastName: "Demo",
      contactEmail: email,
      usAuthorized: false,
      requiresSponsorship: false,
      willingToRelocate: false,
      preferredLocations: [],
      references: [],
      salaryPreferences: [],
    },
    "PUT",
  );
  const policy = z
    .object({
      submissionMode: z.literal("DRY_RUN"),
      liveSubmissionsEnabled: z.literal(false),
      unrestrictedAgentsEnabled: z.literal(false),
    })
    .parse(await request("/api/execution/policy"));
  if (
    policy.submissionMode !== "DRY_RUN" ||
    policy.liveSubmissionsEnabled ||
    policy.unrestrictedAgentsEnabled
  )
    throw new Error("Server execution boundary is invalid.");
  const resumes = [];
  for (const role of ["Business Analyst", "Project Manager", "Program Manager"]) {
    const resume = idSchema.parse(
      await request("/api/resumes/", {
        label: `SYNTHETIC ${role}`,
        content: {
          basics: { name: "Synthetic Demo Candidate", headline: role, email },
          summary: "Synthetic fixture only; no real applicant qualifications.",
        },
      }),
    );
    const detail = versionSchema
      .extend({ reviewRevision: z.number().int() })
      .parse(await request(`/api/resumes/${resume.id}`));
    await request(`/api/resumes/${resume.id}/review`, {
      action: "approve",
      expectedVersion: detail.version,
      expectedReviewRevision: detail.reviewRevision,
    });
    resumes.push(resume.id);
  }
  const contact = versionSchema.parse(
    await request("/api/information-bank/", {
      question: "What is your preferred contact email?",
      aliases: [],
      intent: "contact",
      category: "identity",
      scope: "global",
      scopeKey: null,
      answer: { kind: "text", value: email },
    }),
  );
  await request(`/api/information-bank/${contact.id}/approve`, {
    expectedVersion: contact.version,
    reviewDueAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const keys = generateKeyPairSync("ed25519");
  const integration = await db.ingestionIntegration.create({
    data: {
      userId: account.user.id,
      publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      active: true,
    },
  });
  const rawJob = {
    job_id: crypto.randomUUID(),
    job_title: "Program Manager",
    employer_name: "Synthetic Demo Company",
    job_apply_link: `https://jobs.example.invalid/${crypto.randomUUID()}`,
    job_location: "United States — Nationwide",
    job_description:
      "Synthetic discovery fixture. Employer eligibility and match score remain unverified.",
  };
  const freshJobs = ["Program Manager", "Project Manager", "Business Analyst"].flatMap((role) =>
    [1, 2, 3].map((sample) => ({
      ...rawJob,
      job_id: crypto.randomUUID(),
      job_title: role,
      employer_name: `Synthetic ${role} Company ${sample}`,
      job_apply_link: `https://jobs.example.invalid/${crypto.randomUUID()}`,
    })),
  );
  const mapped = mapJSearch({ status: "OK", data: { jobs: [rawJob, rawJob, ...freshJobs] } });
  if (mapped.jobs.length !== 10) throw new Error("Structured discovery deduplication failed.");
  const batch = { schemaVersion: 1, runId: crypto.randomUUID(), jobs: mapped.jobs };
  const bytes = JSON.stringify(batch);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const digest = createHash("sha256").update(bytes).digest("hex");
  const message = `jobpilot-ingestion-v1\nPOST\n/api/integrations/n8n/ingest\n${integration.id}\n${timestamp}\n${digest}`;
  const signature = sign(null, Buffer.from(message), keys.privateKey).toString("base64");
  async function ingest() {
    const response = await fetch(`${api}/api/integrations/n8n/ingest`, {
      method: "POST",
      redirect: "error",
      body: bytes,
      headers: {
        "Content-Type": "application/json",
        "X-JobPilot-Integration": integration.id,
        "X-JobPilot-Timestamp": timestamp,
        "X-JobPilot-Signature": signature,
      },
    });
    const value = z
      .object({ id: z.uuid(), duplicate: z.boolean(), disposition: z.literal("stored_only") })
      .parse(await response.json());
    if (!response.ok || value.disposition !== "stored_only")
      throw new Error("Signed ingestion failed.");
    return value;
  }
  const receipt = await ingest();
  if (!(await ingest()).duplicate) throw new Error("Ingestion replay was not deduplicated.");
  const preview = await request(`/api/auto-apply/preview?ingestionRunId=${receipt.id}`);
  const preparation = idSchema
    .extend({
      status: z.literal("review"),
      revision: z.number().int(),
      runtime: z.object({ canSubmit: z.literal(false) }),
    })
    .parse(
      await request("/api/preparations", {
        requestId: crypto.randomUUID(),
        ingestionRunId: receipt.id,
        sourceId: mapped.jobs[0]?.sourceId,
      }),
    );
  if (preparation.status !== "review" || preparation.runtime.canSubmit !== false)
    throw new Error("Preparation did not fail closed for unknown questions.");
  const blocked = await fetch(`${api}/api/preparations/${preparation.id}/simulate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ expectedRevision: preparation.revision }),
  });
  if (blocked.status !== 403) throw new Error("Unanswered preparation was not blocked.");
  if (await db.application.count({ where: { userId: account.user.id } }))
    throw new Error("Unexpected Application write.");
  mkdirSync("/tmp/jobpilot-mvp", { recursive: true, mode: 0o700 });
  const artifact = "/tmp/jobpilot-mvp/demo.json";
  writeFileSync(
    artifact,
    JSON.stringify(
      {
        email,
        password,
        cookie,
        userId: account.user.id,
        preparationId: preparation.id,
        ingestionRunId: receipt.id,
        resumes,
        preview,
      },
      null,
      2,
    ),
  );
  chmodSync(artifact, 0o600);
  console.log(
    JSON.stringify({
      status: "review_required",
      url: "http://127.0.0.1:4100/preparation",
      preparationId: preparation.id,
      syntheticJobs: mapped.jobs.length,
      approvedResumes: resumes.length,
      unknownQuestionBlocked: true,
      liveApplications: 0,
      privateDemoArtifact: artifact,
    }),
  );
} finally {
  await db.$disconnect();
}
