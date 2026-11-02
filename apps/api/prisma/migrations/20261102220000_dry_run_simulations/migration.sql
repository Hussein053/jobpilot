CREATE TABLE "dry_run_simulations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "request_id" TEXT NOT NULL,
  "request_digest" TEXT NOT NULL,
  "ingestion_run_id" TEXT NOT NULL,
  "settings_version" INTEGER NOT NULL CHECK ("settings_version" >= 0),
  "snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "dry_run_simulations_user_id_request_id_key" ON "dry_run_simulations"("user_id", "request_id");
CREATE INDEX "dry_run_simulations_user_id_created_at_idx" ON "dry_run_simulations"("user_id", "created_at");
CREATE TABLE "dry_run_reservations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "simulation_id" TEXT NOT NULL REFERENCES "dry_run_simulations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "source_id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "company" TEXT NOT NULL,
  "day_starts_at" TIMESTAMP(3) NOT NULL,
  "resume_id" TEXT NOT NULL,
  "resume_version" INTEGER NOT NULL CHECK ("resume_version" > 0),
  "resume_review_revision" INTEGER NOT NULL CHECK ("resume_review_revision" >= 0),
  "settings_version" INTEGER NOT NULL CHECK ("settings_version" >= 0),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "dry_run_reservations_user_id_source_id_day_starts_at_key" ON "dry_run_reservations"("user_id", "source_id", "day_starts_at");
CREATE UNIQUE INDEX "dry_run_reservations_user_id_url_day_starts_at_key" ON "dry_run_reservations"("user_id", "url", "day_starts_at");
CREATE INDEX "dry_run_reservations_user_id_created_at_idx" ON "dry_run_reservations"("user_id", "created_at");
CREATE FUNCTION reject_dry_run_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN RAISE EXCEPTION 'Dry-run history is append-only'; END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER dry_run_simulations_immutable BEFORE UPDATE OR DELETE ON "dry_run_simulations"
FOR EACH ROW EXECUTE FUNCTION reject_dry_run_mutation();
CREATE TRIGGER dry_run_reservations_immutable BEFORE UPDATE OR DELETE ON "dry_run_reservations"
FOR EACH ROW EXECUTE FUNCTION reject_dry_run_mutation();
