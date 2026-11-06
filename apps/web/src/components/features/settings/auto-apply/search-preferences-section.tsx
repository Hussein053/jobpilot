"use client";
import { AUTO_APPLY_DEFAULTS, autoApplyPreferencesSchema } from "@jobpilot/contracts/auto-apply";
import { Autocomplete, Stack, TextField } from "@mui/material";
import { withForm } from "@/components/ui/form/tanstack";
import { firstErrorMessage } from "@/components/ui/form/tanstack/error-message";
import { SectionCard } from "@/components/ui/layout";

export const SearchPreferencesSection = withForm({
  defaultValues: autoApplyPreferencesSchema.parse(AUTO_APPLY_DEFAULTS),
  render: function SearchPreferencesSection({ form }) {
    return (
      <SectionCard
        title="Jobs to look for"
        description="Use canonical role names or add your own. Unlisted salary is not presumed to meet your minimum."
      >
        <Stack spacing={3}>
          <form.Field name="roles">
            {(field) => (
              <Autocomplete
                multiple
                freeSolo
                options={AUTO_APPLY_DEFAULTS.roles}
                value={field.state.value}
                onChange={(_, values) => field.handleChange(values)}
                onBlur={field.handleBlur}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Target roles"
                    helperText={
                      firstErrorMessage(field.state.meta.errors) ??
                      "Type a role and press Enter to add it."
                    }
                    error={field.state.meta.errors.length > 0}
                  />
                )}
              />
            )}
          </form.Field>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <form.AppField name="minimumSalaryUSD">
              {(field) => (
                <field.TextField fullWidth label="Minimum annual base salary (USD)" type="number" />
              )}
            </form.AppField>
            <form.AppField name="unlistedSalary">
              {(field) => (
                <field.Select
                  label="When salary is unlisted"
                  items={[
                    { value: "allow", label: "Allow — do not assume salary meets minimum" },
                    { value: "review", label: "Send to review" },
                    { value: "skip", label: "Skip" },
                  ]}
                />
              )}
            </form.AppField>
          </Stack>
          <form.AppField name="location">
            {(field) => (
              <field.TextField
                fullWidth
                label="Location"
                helperText="Use United States — Nationwide, or enter a custom city, state, or region."
              />
            )}
          </form.AppField>
          <form.AppField name="workArrangements">
            {(field) => (
              <field.Multiselect
                label="Work arrangements"
                freeSolo={false}
                options={["Remote", "Hybrid", "On-site"]}
              />
            )}
          </form.AppField>
        </Stack>
      </SectionCard>
    );
  },
});
