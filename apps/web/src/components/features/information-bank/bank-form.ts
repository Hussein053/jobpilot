import {
  ANSWER_CATEGORIES,
  ANSWER_INTENTS,
  ANSWER_SCOPES,
  type BankEntryDefinition,
  bankEntryDefinitionSchema,
} from "@jobpilot/contracts/information-bank";
import { z } from "zod/v4";
import type { BankEntry } from "./bank-options";

export const bankFormSchema = z
  .object({
    question: z.string(),
    aliasesText: z.string(),
    intent: z.enum(ANSWER_INTENTS),
    category: z.enum(ANSWER_CATEGORIES),
    scope: z.enum(ANSWER_SCOPES),
    scopeKey: z.string(),
    kind: z.enum(["text", "boolean", "number", "date", "choice", "multiple_choice"]),
    answerText: z.string(),
    optionsText: z.string(),
  })
  .superRefine((form, context) => {
    const result = bankEntryDefinitionSchema.safeParse(formDefinition(form));
    if (!result.success)
      for (const issue of result.error.issues) {
        let field = issue.path[0];
        if (field === "answer") field = issue.path[1] === "options" ? "optionsText" : "answerText";
        if (field === "aliases") field = "aliasesText";
        context.addIssue({
          code: "custom",
          path: [String(field ?? "question")],
          message: issue.message,
        });
      }
  });
export type BankFormValues = z.infer<typeof bankFormSchema>;
const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
function formDefinition(form: BankFormValues) {
  let value: unknown = form.answerText;
  if (form.kind === "boolean") {
    value = undefined;
    if (form.answerText === "true") value = true;
    if (form.answerText === "false") value = false;
  }
  if (form.kind === "number") value = form.answerText.trim() ? Number(form.answerText) : Number.NaN;
  if (form.kind === "multiple_choice") value = lines(form.answerText);
  const answer: Record<string, unknown> = { kind: form.kind, value };
  if (form.kind === "choice" || form.kind === "multiple_choice")
    answer.options = lines(form.optionsText);
  return {
    question: form.question,
    aliases: lines(form.aliasesText),
    intent: form.intent,
    category: form.category,
    scope: form.scope,
    scopeKey: form.scope === "global" ? null : form.scopeKey,
    answer,
  };
}
export function parseBankForm(values: BankFormValues): BankEntryDefinition {
  return bankEntryDefinitionSchema.parse(formDefinition(values));
}
export function bankFormDefaults(entry?: BankEntry): BankFormValues {
  if (!entry)
    return {
      question: "",
      aliasesText: "",
      intent: "other",
      category: "other",
      scope: "global",
      scopeKey: "",
      kind: "text",
      answerText: "",
      optionsText: "",
    };
  const definition = entry.definition;
  const answer = definition.answer;
  let value = String(answer.value);
  if (Array.isArray(answer.value)) value = answer.value.join("\n");
  return {
    question: definition.question,
    aliasesText: definition.aliases.join("\n"),
    intent: definition.intent,
    category: definition.category,
    scope: definition.scope,
    scopeKey: definition.scopeKey ?? "",
    kind: answer.kind,
    answerText: value,
    optionsText: "options" in answer ? answer.options.join("\n") : "",
  };
}
