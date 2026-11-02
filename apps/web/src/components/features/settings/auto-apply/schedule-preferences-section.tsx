"use client";
import { AUTO_APPLY_DEFAULTS, autoApplyPreferencesSchema } from "@jobpilot/contracts/auto-apply";
import { Alert, Button, Stack, TextField, Typography } from "@mui/material";
import { useSelector } from "@tanstack/react-form";
import { withForm } from "@/components/ui/form/tanstack";
import { firstErrorMessage } from "@/components/ui/form/tanstack/error-message";
import { SectionCard } from "@/components/ui/layout";

export const SchedulePreferencesSection = withForm({
  defaultValues: autoApplyPreferencesSchema.parse(AUTO_APPLY_DEFAULTS),
  render: function SchedulePreferencesSection({ form }) {
    const frequency = useSelector(form.store, (state) => state.values.searchFrequency);
    let scheduleDescription =
      "Run hours use the saved timezone. Repeated or missing DST hours require the scheduler’s explicit handling.";
    if (frequency === "hourly")
      scheduleDescription = "Hourly means each local hour boundary in the saved timezone.";
    if (frequency === "manual") scheduleDescription = "Manual means no scheduled searches.";
    return (
      <SectionCard
        title="Limits and schedule"
        description="Schedule preferences do not start searches. The scheduler and provider quotas remain independently controlled."
      >
        <Stack spacing={3}>
          <form.AppField name="maxDailyApplications">
            {(field) => (
              <field.TextField label="Daily application cap (1–100)" type="number" fullWidth />
            )}
          </form.AppField>
          <Alert severity="info">
            Recorded daily count and remaining quota will appear in the policy preview. Dry-run
            evaluations never count as submitted applications.
          </Alert>
          <form.AppField name="searchFrequency">
            {(field) => (
              <field.Select
                label="Search frequency"
                items={[
                  { value: "hourly", label: "Hourly" },
                  { value: "three_times_daily", label: "Three times daily" },
                  { value: "manual", label: "Manual only" },
                ]}
              />
            )}
          </form.AppField>
          <form.AppField name="timeZone">
            {(field) => (
              <field.TextField
                label="IANA timezone"
                helperText="For example America/New_York or UTC. No timezone is inferred from your location."
                fullWidth
              />
            )}
          </form.AppField>
          <Button
            type="button"
            sx={{ alignSelf: "flex-start" }}
            onClick={() =>
              form.setFieldValue("timeZone", Intl.DateTimeFormat().resolvedOptions().timeZone)
            }
          >
            Use this device’s timezone
          </Button>
          {frequency === "three_times_daily" && (
            <form.Field name="runHours">
              {(field) => (
                <Stack spacing={1}>
                  <Typography variant="body2Strong">Three local run hours (0–23)</Typography>
                  <Stack direction="row" spacing={1}>
                    {[0, 1, 2].map((position) => (
                      <TextField
                        key={`hour-${position}`}
                        type="number"
                        label={`Run ${position + 1}`}
                        value={
                          Number.isFinite(field.state.value[position])
                            ? field.state.value[position]
                            : ""
                        }
                        slotProps={{ htmlInput: { min: 0, max: 23, step: 1 } }}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(
                            field.state.value.map((hour, index) => {
                              if (index !== position) return hour;
                              return event.target.value === ""
                                ? Number.NaN
                                : Number(event.target.value);
                            }),
                          )
                        }
                      />
                    ))}
                  </Stack>
                  {field.state.meta.errors.length > 0 && (
                    <Typography color="error" variant="caption">
                      {firstErrorMessage(field.state.meta.errors)}
                    </Typography>
                  )}
                </Stack>
              )}
            </form.Field>
          )}
          <Typography variant="captionMuted">{scheduleDescription}</Typography>
        </Stack>
      </SectionCard>
    );
  },
});
