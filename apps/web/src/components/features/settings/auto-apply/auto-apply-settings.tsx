"use client";
import { type ReactElement, useState } from "react";
import type { Data } from "@jobpilot/api-client";
import {
  type AutoApplyPreferences,
  autoApplyPreferencesSchema,
} from "@jobpilot/contracts/auto-apply";
import { Alert, Box, Button, Chip, LinearProgress, Stack, Typography } from "@mui/material";
import { useSelector } from "@tanstack/react-form";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import { autoApplyQueries, resumeQueries } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import { useAppForm } from "@/components/ui/form/tanstack";
import { SectionCard, StickyFooter } from "@/components/ui/layout";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { useConfirm } from "@/providers/confirm-provider";
import { InstallHelp } from "./install-help";
import { ResumePreferencesSection } from "./resume-preferences-section";
import { SchedulePreferencesSection } from "./schedule-preferences-section";
import { SearchPreferencesSection } from "./search-preferences-section";
import { SettingsHistory } from "./settings-history";

type SettingsResponse = Data<(typeof api)["auto-apply"]["settings"]["get"]>;

export function AutoApplySettings(): ReactElement {
  const query = useApiQuery(autoApplyQueries.settings());
  if (query.isError)
    return (
      <Alert severity="error" action={<Button onClick={() => query.refetch()}>Retry</Button>}>
        Could not load settings. {query.error?.message}
      </Alert>
    );
  if (!query.data) return <LinearProgress aria-label="Loading Auto-Apply settings" />;
  return (
    <Stack spacing={3}>
      <Alert severity="warning" role="status">
        <Typography variant="body2Strong">DRY RUN — NO APPLICATIONS WILL BE SUBMITTED</Typography>
        <Typography variant="body2">
          Live activation is disabled independently of these preferences. Browser execution remains
          disabled.
        </Typography>
      </Alert>
      <SettingsEditor initial={query.data} />
      <SettingsHistory />
      <InstallHelp />
    </Stack>
  );
}

interface SettingsEditorProps {
  initial: SettingsResponse;
}

function SettingsEditor(props: SettingsEditorProps): ReactElement {
  const { initial } = props;
  const confirm = useConfirm();
  const [saved, setSaved] = useState(initial);
  const [notice, setNotice] = useState("");
  const resumes = useApiQuery(resumeQueries.list());
  const reload = useApiQuery(autoApplyQueries.settings(), { enabled: false });
  const save = useApiMutation(
    (settings: AutoApplyPreferences) =>
      api["auto-apply"].settings.patch({ expectedVersion: saved.version, changes: settings }),
    {
      showErrorToast: false,
      invalidate: [queryKeys.autoApply.all],
      onSuccess: (data) => {
        setSaved(data);
        form.reset(data.settings);
        setNotice("Preferences saved. Live activation remains disabled.");
      },
    },
  );
  const form = useAppForm({
    defaultValues: saved.settings,
    validators: { onSubmit: autoApplyPreferencesSchema },
    onSubmitInvalid: () => setNotice("Fix the highlighted fields before saving."),
    onSubmit: async ({ value }) => {
      setNotice("");
      try {
        await save.mutateAsync(value);
      } catch {
        /* The error stays beside the save controls. */
      }
    },
  });
  const pristine = useSelector(form.store, (state) => state.isDefaultValue);
  useUnsavedChangesGuard(!pristine);

  const loadLatest = async () => {
    if (
      !pristine &&
      !(await confirm({
        title: "Reload saved settings?",
        description: "This discards the edits on this screen.",
        confirmLabel: "Reload",
      }))
    )
      return;
    const result = await reload.refetch();
    if (result.data) {
      setSaved(result.data);
      form.reset(result.data.settings);
      save.reset();
      setNotice("Loaded the latest saved preferences.");
    }
  };

  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <Stack spacing={3}>
        <SectionCard
          title="Auto-Apply preferences"
          description="Save your search rules now. A saved request cannot activate submissions."
        >
          <Stack spacing={2}>
            <form.AppField name="autoApplyRequested">
              {(field) => (
                <field.Switch label="Request automatic applications when separately activated" />
              )}
            </form.AppField>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              <Chip label="Execution: DRY_RUN" color="warning" />
              <Chip label="Live activation: Disabled" variant="outlined" />
              <Chip label={`Saved version: ${saved.version}`} variant="outlined" />
            </Stack>
            <Typography variant="captionMuted">
              {saved.updatedAt
                ? `Last saved ${new Date(saved.updatedAt).toLocaleString()}`
                : "Default preferences — not yet saved"}
            </Typography>
          </Stack>
        </SectionCard>

        <SearchPreferencesSection form={form} />

        <SchedulePreferencesSection form={form} />

        <ResumePreferencesSection
          form={form}
          resumeReady={saved.resumeReady}
          resumes={resumes.data?.filter((resume) => resume.approved) ?? []}
        />

        <StickyFooter>
          {save.error && (
            <Alert severity="error" role="alert">
              {save.error instanceof ApiError && save.error.code === "STALE_WRITE"
                ? "Settings changed elsewhere. Your edits are retained; reload saved settings before saving again."
                : save.error.message}
            </Alert>
          )}
          {notice && (
            <Typography role="status" variant="body2">
              {notice}
            </Typography>
          )}
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ alignItems: { sm: "center" }, justifyContent: "flex-end" }}
          >
            <Typography variant="captionMuted">
              {pristine ? "No unsaved changes" : "Unsaved changes"}
            </Typography>
            <Button type="button" disabled={save.isPending} onClick={loadLatest}>
              Reload saved
            </Button>
            <Button
              type="button"
              disabled={pristine || save.isPending}
              onClick={() => {
                form.reset(saved.settings);
                save.reset();
                setNotice("Edits reverted.");
              }}
            >
              Cancel / revert
            </Button>
            <Button type="submit" variant="contained" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save preferences"}
            </Button>
          </Stack>
        </StickyFooter>
      </Stack>
    </Box>
  );
}
