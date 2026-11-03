import {
  AUTO_APPLY_DEFAULTS,
  type AutoApplyPreferences,
  autoApplyPreferencesSchema,
} from "@jobpilot/contracts/auto-apply";
import type { AutoApplyPolicy } from "@/generated/prisma/client";

export function policyPreferences(row: AutoApplyPolicy | null): AutoApplyPreferences {
  if (!row) return autoApplyPreferencesSchema.parse(AUTO_APPLY_DEFAULTS);
  const { userId: _, version: __, updatedAt: ___, ...fields } = row;
  return autoApplyPreferencesSchema.parse({
    ...fields,
    workArrangements: fields.workArrangements.map((value) =>
      value === "OnSite" ? "On-site" : value,
    ),
  });
}
