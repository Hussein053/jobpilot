import { z } from "zod/v4";

export const ANSWER_INTENTS = [
  "contact",
  "employment_preferences",
  "minimum_salary",
  "desired_salary",
  "education",
  "experience_sql_years",
  "experience_total_years",
  "certifications",
  "work_authorization",
  "sponsorship",
  "immigration_status",
  "criminal_history",
  "disability",
  "eeo",
  "legal_attestation",
  "company_motivation",
  "role_motivation",
  "other",
] as const;
export const ANSWER_CATEGORIES = [
  "identity",
  "employment_preferences",
  "compensation",
  "education",
  "experience",
  "certifications",
  "work_eligibility",
  "company_specific",
  "other",
] as const;
export const ANSWER_SCOPES = ["global", "role", "company", "job"] as const;
export const ANSWER_STATUSES = ["draft", "approved", "revoked"] as const;
export const ANSWER_EVENT_ACTIONS = [
  "created",
  "edited",
  "approved",
  "revoked",
  "deleted",
] as const;
export type AnswerIntent = (typeof ANSWER_INTENTS)[number];

const text = z.string().trim().min(1).max(5000);
const choices = z
  .array(text)
  .min(1)
  .max(100)
  .refine((items) => new Set(items).size === items.length, "Choices must be distinct");
export const bankAnswerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), value: text }),
  z.strictObject({ kind: z.literal("boolean"), value: z.boolean() }),
  z.strictObject({
    kind: z.literal("number"),
    value: z.number().finite().min(-1_000_000_000).max(1_000_000_000),
  }),
  z.strictObject({ kind: z.literal("date"), value: z.iso.date() }),
  z
    .strictObject({ kind: z.literal("choice"), options: choices, value: text })
    .refine((answer) => answer.options.includes(answer.value), "Select an available choice"),
  z
    .strictObject({
      kind: z.literal("multiple_choice"),
      options: choices,
      value: z.array(text).max(100),
    })
    .refine(
      (answer) =>
        new Set(answer.value).size === answer.value.length &&
        answer.value.every((value) => answer.options.includes(value)),
      "Select distinct available choices",
    ),
]);

export function isSensitiveIntent(intent: AnswerIntent): boolean {
  return [
    "minimum_salary",
    "desired_salary",
    "work_authorization",
    "sponsorship",
    "immigration_status",
    "criminal_history",
    "disability",
    "eeo",
    "legal_attestation",
  ].includes(intent);
}

const forbiddenQuestion =
  /\b(password|passcode|otp|captcha|ssn)\b|one[- ]time (code|password)|social security|government[- ]?id|passport (number|id)|driver.?s licen[sc]e (number|id)|credit card|payment (card|credential)|bank account|routing number|api[- ]?key|private key/i;
const meanings: [RegExp, AnswerIntent][] = [
  [
    /authori[sz]ed to work|work authori[sz]ation|right to work|legally (permitted|eligible|allowed) to work/i,
    "work_authorization",
  ],
  [/sponsor(ship|ed|ing)?/i, "sponsorship"],
  [/immigration|visa status|citizenship|citizen of/i, "immigration_status"],
  [/criminal|conviction|convicted/i, "criminal_history"],
  [/disabilit|reasonable accommodation/i, "disability"],
  [/\bgender\b|\brace\b|ethnic|veteran|demographic|\beeo\b/i, "eeo"],
  [/\bconsent\b|\bcertify\b|\battest\b|agree to|background check/i, "legal_attestation"],
  [/years?.*\bsql\b|\bsql\b.*years?/i, "experience_sql_years"],
];

export const bankEntryDefinitionSchema = z
  .strictObject({
    question: z.string().trim().min(1).max(1000),
    aliases: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
    intent: z.enum(ANSWER_INTENTS),
    category: z.enum(ANSWER_CATEGORIES),
    scope: z.enum(ANSWER_SCOPES),
    scopeKey: z.string().trim().min(1).max(2000).nullable(),
    answer: bankAnswerSchema,
  })
  .superRefine((entry, context) => {
    if ((entry.scope === "global") !== (entry.scopeKey === null))
      context.addIssue({
        code: "custom",
        path: ["scopeKey"],
        message: "Only global answers have no scope key",
      });
    const questions = [entry.question, ...entry.aliases];
    if (new Set(questions.map((q) => q.normalize("NFC"))).size !== questions.length)
      context.addIssue({
        code: "custom",
        path: ["aliases"],
        message: "Remove duplicate questions",
      });
    for (const question of questions) {
      if (forbiddenQuestion.test(question))
        context.addIssue({
          code: "custom",
          path: ["question"],
          message:
            "Passwords, one-time codes, IDs, payment credentials, and API secrets cannot be reusable answers",
        });
      for (const [pattern, intent] of meanings)
        if (pattern.test(question) && entry.intent !== intent)
          context.addIssue({
            code: "custom",
            path: ["intent"],
            message:
              "Choose the exact question meaning; ambiguous questions require application-specific review",
          });
    }
    if (entry.scope === "job" && entry.scopeKey) {
      try {
        const url = new URL(entry.scopeKey);
        if (url.protocol !== "https:" || url.username || url.password || url.hash)
          throw new Error();
      } catch {
        context.addIssue({
          code: "custom",
          path: ["scopeKey"],
          message: "Use the exact HTTPS job URL without credentials or a fragment",
        });
      }
    }
  });
export type BankEntryDefinition = z.infer<typeof bankEntryDefinitionSchema>;
export function requiresSpecificContext(
  entry: Pick<BankEntryDefinition, "intent" | "question" | "aliases">,
): boolean {
  if (isSensitiveIntent(entry.intent)) return true;
  return [entry.question, ...entry.aliases].some((question) =>
    /salary|compensation|date of birth|birth ?date|\bage\b|nationality|religion|marital|medical history|health condition|legally|immigration|\bvisa\b/i.test(
      question,
    ),
  );
}
export const bankProvenanceSchema = z.strictObject({
  kind: z.enum(["user_entered", "profile_draft", "resume_draft"]),
  referenceId: z.string().nullable(),
  referenceVersion: z.number().int().nullable(),
});
export const editBankEntrySchema = z.strictObject({
  expectedVersion: z.number().int().positive().max(2147483646),
  definition: bankEntryDefinitionSchema,
});
export const bankVersionSchema = z.strictObject({
  expectedVersion: z.number().int().positive().max(2147483646),
});
export const approveBankEntrySchema = bankVersionSchema.extend({
  reviewDueAt: z.iso.datetime({ offset: true }),
});
