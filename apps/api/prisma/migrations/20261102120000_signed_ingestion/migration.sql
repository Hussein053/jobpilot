CREATE TABLE "ingestion_integrations" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "public_key_pem" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ingestion_integrations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ingestion_integrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ingestion_integrations_user_id_idx" ON "ingestion_integrations"("user_id");
CREATE TABLE "ingestion_runs" (
  "id" TEXT NOT NULL,
  "integration_id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "body_digest" TEXT NOT NULL,
  "batch" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ingestion_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ingestion_runs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "ingestion_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ingestion_runs_digest_check" CHECK ("body_digest" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "ingestion_runs_integration_id_run_id_key" ON "ingestion_runs"("integration_id", "run_id");
CREATE INDEX "ingestion_runs_integration_id_created_at_idx" ON "ingestion_runs"("integration_id", "created_at");
