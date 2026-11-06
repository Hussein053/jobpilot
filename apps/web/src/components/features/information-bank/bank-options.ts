import type { Data } from "@jobpilot/api-client";
import type {
  ANSWER_CATEGORIES,
  ANSWER_INTENTS,
  ANSWER_SCOPES,
  BankEntryDefinition,
} from "@jobpilot/contracts/information-bank";
import type { api } from "@/api/client";

export type BankEntry = Data<ReturnType<(typeof api)["information-bank"]>["get"]>;
export const categoryLabels: Record<(typeof ANSWER_CATEGORIES)[number], string> = {
  identity: "Identity",
  employment_preferences: "Employment preferences",
  compensation: "Compensation",
  education: "Education",
  experience: "Experience",
  certifications: "Certifications",
  work_eligibility: "Work eligibility",
  company_specific: "Company-specific",
  other: "Other",
};
export const intentLabels: Record<(typeof ANSWER_INTENTS)[number], string> = {
  contact: "Contact details",
  employment_preferences: "Employment preferences",
  minimum_salary: "Minimum acceptable salary",
  desired_salary: "Desired salary",
  education: "Education",
  experience_sql_years: "Years of SQL experience",
  experience_total_years: "Years of total work experience",
  certifications: "Certifications",
  work_authorization: "Authorization to work",
  sponsorship: "Need for sponsorship",
  immigration_status: "Immigration or citizenship",
  criminal_history: "Criminal history",
  disability: "Disability or accommodation",
  eeo: "Voluntary demographics / EEO",
  legal_attestation: "Legal consent or attestation",
  company_motivation: "Interest in this company",
  role_motivation: "Interest in this role",
  other: "Other exact question",
};
export const scopeLabels: Record<(typeof ANSWER_SCOPES)[number], string> = {
  global: "All compatible applications",
  role: "One role",
  company: "One company",
  job: "One exact job",
};
export const answerLabels: Record<BankEntryDefinition["answer"]["kind"], string> = {
  text: "Text",
  boolean: "Yes / No",
  number: "Number",
  date: "Date",
  choice: "One choice",
  multiple_choice: "Multiple choices",
};
export const privateQueryOptions = { gcTime: 0, retry: false, networkMode: "always" } as const;
export const privateMutationOptions = { gcTime: 0, retry: false, networkMode: "always" } as const;
export function answerText(answer: BankEntryDefinition["answer"]): string {
  if (typeof answer.value === "boolean") return answer.value ? "Yes" : "No";
  if (Array.isArray(answer.value)) return answer.value.join("\n");
  return String(answer.value);
}
