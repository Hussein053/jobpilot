-- CreateTable
CREATE TABLE "preparation_answer_uses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "preparation_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "entry_version" INTEGER NOT NULL,
    "key_cipher" TEXT NOT NULL,
    "payload_cipher" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preparation_answer_uses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "application_preparations_id_user_id_key" ON "application_preparations"("id", "user_id");

-- CreateIndex
CREATE INDEX "preparation_answer_uses_user_id_preparation_id_idx" ON "preparation_answer_uses"("user_id", "preparation_id");

-- CreateIndex
CREATE UNIQUE INDEX "preparation_answer_uses_preparation_id_question_id_key" ON "preparation_answer_uses"("preparation_id", "question_id");

-- AddForeignKey
ALTER TABLE "preparation_answer_uses" ADD CONSTRAINT "preparation_answer_uses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preparation_answer_uses" ADD CONSTRAINT "preparation_answer_uses_preparation_id_user_id_fkey" FOREIGN KEY ("preparation_id", "user_id") REFERENCES "application_preparations"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "preparation_answer_uses" ADD CONSTRAINT "preparation_answer_use_version" CHECK ("entry_version" > 0);
ALTER TABLE "preparation_answer_uses" ADD CONSTRAINT "preparation_answer_use_question" CHECK (length("question_id") BETWEEN 1 AND 100);
CREATE TRIGGER preparation_answer_uses_immutable BEFORE UPDATE OR DELETE ON "preparation_answer_uses"
FOR EACH ROW EXECUTE FUNCTION reject_dry_run_mutation();
CREATE FUNCTION require_simulated_answer_use() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM application_preparations WHERE id = NEW.preparation_id AND user_id = NEW.user_id AND status = 'simulated') THEN
  RAISE EXCEPTION 'Answer use requires an owned completed simulation';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER preparation_answer_use_is_final BEFORE INSERT ON "preparation_answer_uses"
FOR EACH ROW EXECUTE FUNCTION require_simulated_answer_use();
