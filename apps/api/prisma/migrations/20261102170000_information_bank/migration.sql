CREATE TYPE "answer_intent" AS ENUM ('contact','employment_preferences','minimum_salary','desired_salary','education','experience_sql_years','experience_total_years','certifications','work_authorization','sponsorship','immigration_status','criminal_history','disability','eeo','legal_attestation','company_motivation','role_motivation','other');
CREATE TYPE "answer_category" AS ENUM ('identity','employment_preferences','compensation','education','experience','certifications','work_eligibility','company_specific','other');
CREATE TYPE "answer_scope" AS ENUM ('global','role','company','job');
CREATE TYPE "answer_status" AS ENUM ('draft','approved','revoked');
CREATE TYPE "answer_event_action" AS ENUM ('created','edited','approved','revoked','deleted');
CREATE TABLE "answer_entries" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "intent" "answer_intent" NOT NULL,
  "normalized_intent" TEXT NOT NULL,
  "category" "answer_category" NOT NULL,
  "scope" "answer_scope" NOT NULL,
  "scope_fingerprint" TEXT NOT NULL,
  "question_keys" TEXT[] NOT NULL,
  "search_tokens" TEXT[] NOT NULL,
  "status" "answer_status" NOT NULL DEFAULT 'draft',
  "key_cipher" TEXT NOT NULL,
  "payload_cipher" TEXT NOT NULL,
  "approved_at" TIMESTAMP(3),
  "review_due_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "answer_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "answer_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "answer_entries_version_check" CHECK ("version" > 0),
  CONSTRAINT "answer_entries_approval_check" CHECK (
    ("status" = 'approved' AND "approved_at" IS NOT NULL AND "review_due_at" IS NOT NULL AND "review_due_at" > "approved_at") OR
    ("status" <> 'approved' AND "approved_at" IS NULL AND "review_due_at" IS NULL)
  )
);
CREATE UNIQUE INDEX "answer_entries_user_id_normalized_intent_scope_fingerprint_key" ON "answer_entries"("user_id","normalized_intent","scope_fingerprint");
CREATE INDEX "answer_entries_user_id_category_status_idx" ON "answer_entries"("user_id","category","status");
CREATE INDEX "answer_entries_question_keys_idx" ON "answer_entries" USING GIN ("question_keys");
CREATE INDEX "answer_entries_search_tokens_idx" ON "answer_entries" USING GIN ("search_tokens");
CREATE TABLE "answer_entry_events" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "action" "answer_event_action" NOT NULL,
  "actor_token_id" TEXT NOT NULL,
  "payload_cipher" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "answer_entry_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "answer_entry_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "answer_entry_events_payload_check" CHECK (("action" = 'deleted') = ("payload_cipher" IS NULL))
);
CREATE UNIQUE INDEX "answer_entry_events_entry_id_version_key" ON "answer_entry_events"("entry_id","version");
CREATE INDEX "answer_entry_events_user_id_created_at_idx" ON "answer_entry_events"("user_id","created_at");
CREATE FUNCTION reject_answer_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN RAISE EXCEPTION 'Answer history is append-only'; END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER answer_entry_events_immutable BEFORE UPDATE OR DELETE ON "answer_entry_events"
FOR EACH ROW EXECUTE FUNCTION reject_answer_event_mutation();
