CREATE TYPE "preparation_status" AS ENUM ('review', 'ready', 'simulated');
CREATE TYPE "preparation_event_kind" AS ENUM ('prepared', 'reviewed', 'simulated');
CREATE TABLE "application_preparations" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "request_id" TEXT NOT NULL,
 "request_digest" TEXT NOT NULL,
 "ingestion_run_id" TEXT NOT NULL,
 "source_id" TEXT NOT NULL,
 "url" TEXT NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
 "status" "preparation_status" NOT NULL DEFAULT 'review',
 "state" JSONB NOT NULL,
 "simulated_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "preparation_simulated_timestamp" CHECK (("status" = 'simulated') = ("simulated_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "application_preparations_user_id_request_id_key" ON "application_preparations"("user_id", "request_id");
CREATE UNIQUE INDEX "application_preparations_user_id_source_id_key" ON "application_preparations"("user_id", "source_id");
CREATE UNIQUE INDEX "application_preparations_user_id_url_key" ON "application_preparations"("user_id", "url");
CREATE INDEX "application_preparations_user_id_created_at_idx" ON "application_preparations"("user_id", "created_at");
CREATE TABLE "preparation_events" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "preparation_id" TEXT NOT NULL REFERENCES "application_preparations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "revision" INTEGER NOT NULL CHECK ("revision" > 0),
 "kind" "preparation_event_kind" NOT NULL,
 "snapshot" JSONB NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "preparation_events_preparation_id_revision_key" ON "preparation_events"("preparation_id", "revision");
CREATE INDEX "preparation_events_user_id_created_at_idx" ON "preparation_events"("user_id", "created_at");
CREATE TRIGGER preparation_events_immutable BEFORE UPDATE OR DELETE ON "preparation_events"
FOR EACH ROW EXECUTE FUNCTION reject_dry_run_mutation();
CREATE FUNCTION protect_simulated_preparation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status = 'simulated' AND EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN
  RAISE EXCEPTION 'Simulated preparation is immutable';
 END IF;
 IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
 RETURN OLD;
END;
$$;
CREATE TRIGGER simulated_preparation_immutable BEFORE UPDATE OR DELETE ON "application_preparations"
FOR EACH ROW EXECUTE FUNCTION protect_simulated_preparation();
