ALTER TABLE "resumes" ADD COLUMN "review_revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_review_revision_check" CHECK ("review_revision" >= 0);
CREATE TYPE "resume_review_action" AS ENUM ('approve', 'revoke', 'activate', 'deactivate');
CREATE TABLE "resume_review_events" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "resume_id" TEXT NOT NULL,
  "action" "resume_review_action" NOT NULL,
  "resume_version" INTEGER NOT NULL,
  "review_revision" INTEGER NOT NULL,
  "actor_token_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "resume_review_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "resume_review_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "resume_review_events_resume_id_review_revision_key" ON "resume_review_events"("resume_id", "review_revision");
CREATE INDEX "resume_review_events_user_id_created_at_idx" ON "resume_review_events"("user_id", "created_at");
CREATE FUNCTION reject_resume_review_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN
    RAISE EXCEPTION 'Resume review events are append-only';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER resume_review_events_immutable BEFORE UPDATE OR DELETE ON "resume_review_events"
FOR EACH ROW EXECUTE FUNCTION reject_resume_review_mutation();
