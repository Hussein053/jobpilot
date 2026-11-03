-- CreateEnum
CREATE TYPE "discovery_trigger" AS ENUM ('scheduled', 'manual');

-- CreateEnum
CREATE TYPE "discovery_task_state" AS ENUM ('planned', 'fetch_started', 'frozen', 'quarantined');

-- CreateEnum
CREATE TYPE "discovery_delivery_state" AS ENUM ('pending', 'in_flight', 'retry_wait', 'stored', 'quarantined', 'auth_stopped');

-- CreateEnum
CREATE TYPE "discovery_identity_kind" AS ENUM ('source', 'url');

-- CreateEnum
CREATE TYPE "discovery_failure" AS ENUM ('provider_uncertain', 'mapping_invalid', 'identity_conflict', 'transport_error', 'rate_limited', 'remote_error', 'bad_payload', 'auth_failed', 'body_conflict', 'invalid_receipt', 'attempt_limit');

-- CreateEnum
CREATE TYPE "discovery_event_kind" AS ENUM ('claimed', 'provider_started', 'provider_failed', 'frozen', 'delivery_leased', 'stored', 'retry_wait', 'quarantined', 'auth_stopped');

-- CreateTable
CREATE TABLE "discovery_policies" (
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "max_provider_requests_per_day" INTEGER NOT NULL DEFAULT 0,
    "roles_per_slot" INTEGER NOT NULL DEFAULT 1,
    "role_cursor" INTEGER NOT NULL DEFAULT 0,
    "auth_blocked_at" TIMESTAMP(3),
    "provider_blocked_until" TIMESTAMP(3),
    "provider_auth_blocked_at" TIMESTAMP(3),

    CONSTRAINT "discovery_policies_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "discovery_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "request_digest" TEXT NOT NULL,
    "trigger" "discovery_trigger" NOT NULL,
    "slot_key" TEXT NOT NULL,
    "slot_at" TIMESTAMP(3) NOT NULL,
    "settings_version" INTEGER NOT NULL,
    "plan" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_tasks" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "state" "discovery_task_state" NOT NULL DEFAULT 'planned',
    "fetch_request_id" TEXT,
    "started_at" TIMESTAMP(3),
    "freeze_digest" TEXT,
    "mapping" JSONB,
    "failure" "discovery_failure",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_deliveries" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "state" "discovery_delivery_state" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_id" TEXT,
    "lease_until" TIMESTAMP(3),
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_failure" "discovery_failure",
    "last_status" INTEGER,
    "receipt_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovered_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovered_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "kind" "discovery_identity_kind" NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "discovery_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "discovery_event_kind" NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discovery_runs_user_id_created_at_idx" ON "discovery_runs"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_runs_integration_id_request_id_key" ON "discovery_runs"("integration_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_runs_user_id_slot_key_key" ON "discovery_runs"("user_id", "slot_key");

-- CreateIndex
CREATE INDEX "discovery_tasks_state_started_at_idx" ON "discovery_tasks"("state", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_tasks_run_id_position_key" ON "discovery_tasks"("run_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_deliveries_run_id_key" ON "discovery_deliveries"("run_id");

-- CreateIndex
CREATE INDEX "discovery_deliveries_state_next_attempt_at_idx" ON "discovery_deliveries"("state", "next_attempt_at");

-- CreateIndex
CREATE INDEX "discovered_jobs_user_id_last_seen_at_idx" ON "discovered_jobs"("user_id", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "discovered_jobs_id_user_id_key" ON "discovered_jobs"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_identities_user_id_kind_value_key" ON "discovery_identities"("user_id", "kind", "value");

-- CreateIndex
CREATE INDEX "discovery_events_user_id_created_at_idx" ON "discovery_events"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "discovery_policies" ADD CONSTRAINT "discovery_policies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "ingestion_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_tasks" ADD CONSTRAINT "discovery_tasks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "discovery_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_deliveries" ADD CONSTRAINT "discovery_deliveries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "discovery_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovered_jobs" ADD CONSTRAINT "discovered_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_identities" ADD CONSTRAINT "discovery_identities_job_id_user_id_fkey" FOREIGN KEY ("job_id", "user_id") REFERENCES "discovered_jobs"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_events" ADD CONSTRAINT "discovery_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE discovery_policies ADD CONSTRAINT discovery_policy_bounds CHECK (max_provider_requests_per_day BETWEEN 0 AND 10000 AND roles_per_slot BETWEEN 1 AND 3 AND role_cursor >= 0);
ALTER TABLE discovery_tasks ADD CONSTRAINT discovery_task_digest CHECK (freeze_digest IS NULL OR freeze_digest ~ '^[a-f0-9]{64}$');
ALTER TABLE discovery_deliveries ADD CONSTRAINT discovery_delivery_bounds CHECK (digest ~ '^[a-f0-9]{64}$' AND octet_length(body) <= 65536 AND attempts BETWEEN 0 AND 5);
CREATE FUNCTION protect_discovery_body() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.body IS DISTINCT FROM OLD.body OR NEW.digest IS DISTINCT FROM OLD.digest THEN RAISE EXCEPTION 'Frozen discovery bodies are immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER discovery_body_immutable BEFORE UPDATE ON discovery_deliveries FOR EACH ROW EXECUTE FUNCTION protect_discovery_body();
CREATE FUNCTION protect_discovery_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN RAISE EXCEPTION 'Discovery history is append-only'; END IF;
 RETURN OLD;
END;
$$;
CREATE TRIGGER discovery_event_immutable BEFORE UPDATE OR DELETE ON discovery_events FOR EACH ROW EXECUTE FUNCTION protect_discovery_event();
CREATE FUNCTION protect_discovery_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN RAISE EXCEPTION 'Discovery runs are append-only'; END IF;
 RETURN OLD;
END;
$$;
CREATE TRIGGER discovery_run_immutable BEFORE UPDATE OR DELETE ON discovery_runs FOR EACH ROW EXECUTE FUNCTION protect_discovery_run();
CREATE FUNCTION protect_discovery_task() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.position IS DISTINCT FROM OLD.position OR NEW.role IS DISTINCT FROM OLD.role OR NEW.query IS DISTINCT FROM OLD.query OR NEW.created_at IS DISTINCT FROM OLD.created_at OR (OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at) OR (OLD.fetch_request_id IS NOT NULL AND NEW.fetch_request_id IS DISTINCT FROM OLD.fetch_request_id) OR (OLD.freeze_digest IS NOT NULL AND NEW.freeze_digest IS DISTINCT FROM OLD.freeze_digest) THEN RAISE EXCEPTION 'Discovery grants and frozen identities are immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER discovery_task_immutable BEFORE UPDATE ON discovery_tasks FOR EACH ROW EXECUTE FUNCTION protect_discovery_task();
