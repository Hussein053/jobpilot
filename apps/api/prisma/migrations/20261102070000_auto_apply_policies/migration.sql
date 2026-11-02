-- CreateEnum
CREATE TYPE "missing_salary_policy" AS ENUM ('allow', 'review', 'skip');

-- CreateEnum
CREATE TYPE "search_frequency" AS ENUM ('hourly', 'three_times_daily', 'manual');

-- CreateEnum
CREATE TYPE "resume_selection" AS ENUM ('auto', 'manual', 'fixed');

-- CreateEnum
CREATE TYPE "work_arrangement" AS ENUM ('Remote', 'Hybrid', 'OnSite');

-- AlterTable
ALTER TABLE "resumes" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "approved_at" TIMESTAMP(3);
ALTER TABLE resumes ADD COLUMN approved_version INTEGER;

-- CreateTable
CREATE TABLE "auto_apply_policies" (
    "user_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "auto_apply_requested" BOOLEAN NOT NULL,
    "minimum_salary_usd" INTEGER NOT NULL,
    "unlisted_salary" "missing_salary_policy" NOT NULL,
    "roles" TEXT[],
    "location" TEXT NOT NULL,
    "work_arrangements" "work_arrangement"[],
    "max_daily_applications" INTEGER NOT NULL,
    "search_frequency" "search_frequency" NOT NULL,
    "time_zone" TEXT NOT NULL,
    "run_hours" INTEGER[],
    "resume_selection" "resume_selection" NOT NULL,
    "fixed_resume_id" TEXT,
    "minimum_match_score" INTEGER NOT NULL,
    "approval_for_exceptions" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auto_apply_policies_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "auto_apply_audit_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "actor_token_id" TEXT NOT NULL,
    "previous_version" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "previous_preferences" JSONB,
    "preferences" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_apply_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auto_apply_audit_events_user_id_created_at_idx" ON "auto_apply_audit_events"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "auto_apply_audit_events_user_id_version_key" ON "auto_apply_audit_events"("user_id", "version");

-- AddForeignKey
ALTER TABLE "auto_apply_policies" ADD CONSTRAINT "auto_apply_policies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_apply_audit_events" ADD CONSTRAINT "auto_apply_audit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Arrays are required preferences, not nullable search hints.
ALTER TABLE auto_apply_policies
  ALTER COLUMN roles SET NOT NULL,
  ALTER COLUMN work_arrangements SET NOT NULL,
  ALTER COLUMN run_hours SET NOT NULL,
  ADD CONSTRAINT auto_apply_policy_bounds CHECK (
    version >= 1 AND minimum_salary_usd >= 0 AND
    max_daily_applications BETWEEN 1 AND 100 AND minimum_match_score BETWEEN 50 AND 100 AND
    approval_for_exceptions AND cardinality(roles) BETWEEN 1 AND 30 AND
    cardinality(work_arrangements) BETWEEN 1 AND 3 AND cardinality(run_hours) = 3 AND
    0 <= ALL(run_hours) AND 23 >= ALL(run_hours) AND
    length(trim(location)) > 0 AND
    ((resume_selection = 'fixed') = (fixed_resume_id IS NOT NULL))
  );

ALTER TABLE auto_apply_audit_events ADD CONSTRAINT auto_apply_audit_versions CHECK (
  previous_version >= 0 AND version = previous_version + 1 AND
  jsonb_typeof(preferences) = 'object' AND
  ((previous_version = 0 AND previous_preferences IS NULL) OR
   (previous_version > 0 AND previous_preferences IS NOT NULL AND jsonb_typeof(previous_preferences) = 'object'))
);

-- History is append-only while its owner exists. Account deletion still cascades.
CREATE FUNCTION protect_auto_apply_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Auto-apply history is append-only' USING ERRCODE = '23000';
END;
$$;
CREATE TRIGGER auto_apply_audit_immutable BEFORE UPDATE OR DELETE ON auto_apply_audit_events
FOR EACH ROW EXECUTE FUNCTION protect_auto_apply_audit();
