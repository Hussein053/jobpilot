"use client";
import { AUTO_APPLY_DEFAULTS, autoApplyPreferencesSchema } from "@jobpilot/contracts/auto-apply";
import {
  Alert,
  Box,
  FormControlLabel,
  MenuItem,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useSelector } from "@tanstack/react-form";
import { withForm } from "@/components/ui/form/tanstack";
import { firstErrorMessage } from "@/components/ui/form/tanstack/error-message";
import { SectionCard } from "@/components/ui/layout";

export const ResumePreferencesSection = withForm({
  defaultValues: autoApplyPreferencesSchema.parse(AUTO_APPLY_DEFAULTS),
  props: { resumeReady: false, resumes: [] as { id: string; label: string }[] },
  render: function ResumePreferencesSection({ form, resumeReady, resumes }) {
    const selection = useSelector(form.store, (state) => state.values.resumeSelection);
    return (
      <SectionCard
        title="Resume and match"
        description="Automatic selection uses approved current versions only. A match score is a score out of 100, not a probability."
      >
        <Stack spacing={3}>
          {!resumeReady && (
            <Alert severity="warning">
              No usable approved resume is available for this selection. Uploading or editing a
              resume does not approve it.
            </Alert>
          )}
          <form.Field name="resumeSelection">
            {(field) => (
              <TextField
                select
                fullWidth
                label="Resume selection"
                value={field.state.value}
                onChange={(event) => {
                  const mode = event.target.value;
                  if (mode === "auto" || mode === "manual" || mode === "fixed") {
                    field.handleChange(mode);
                    if (mode !== "fixed") form.setFieldValue("fixedResumeId", null);
                  }
                }}
              >
                <MenuItem value="auto">Automatic best approved resume</MenuItem>
                <MenuItem value="manual">Choose during review</MenuItem>
                <MenuItem value="fixed">Fixed approved resume</MenuItem>
              </TextField>
            )}
          </form.Field>
          {selection === "fixed" && (
            <form.Field name="fixedResumeId">
              {(field) => (
                <TextField
                  select
                  fullWidth
                  label="Fixed resume"
                  value={field.state.value ?? ""}
                  onChange={(event) => field.handleChange(event.target.value || null)}
                  error={field.state.meta.errors.length > 0}
                  helperText={
                    firstErrorMessage(field.state.meta.errors) ??
                    "The server checks ownership, activity, and version-specific approval."
                  }
                >
                  <MenuItem value="">Choose a resume</MenuItem>
                  {resumes.map((resume) => (
                    <MenuItem key={resume.id} value={resume.id}>
                      {resume.label}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </form.Field>
          )}
          <form.Field name="minimumMatchScore">
            {(field) => (
              <Box>
                <Typography id="match-threshold" variant="body2Strong">
                  Minimum match score: {field.state.value}/100
                </Typography>
                <Slider
                  aria-labelledby="match-threshold"
                  min={50}
                  max={100}
                  step={1}
                  value={field.state.value}
                  onChange={(_, value) => {
                    if (typeof value === "number") field.handleChange(value);
                  }}
                  valueLabelDisplay="auto"
                />
                {field.state.meta.errors.length > 0 && (
                  <Typography variant="caption" color="error">
                    {firstErrorMessage(field.state.meta.errors)}
                  </Typography>
                )}
              </Box>
            )}
          </form.Field>
          <FormControlLabel
            control={<Switch checked disabled />}
            label="Approval for exceptions is required"
          />
        </Stack>
      </SectionCard>
    );
  },
});
