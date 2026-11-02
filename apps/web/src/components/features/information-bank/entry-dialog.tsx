"use client";

import type { ReactElement } from "react";
import {
  ANSWER_CATEGORIES,
  ANSWER_INTENTS,
  ANSWER_SCOPES,
  isSensitiveIntent,
} from "@jobpilot/contracts/information-bank";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useSelector } from "@tanstack/react-form";
import { api } from "@/api/client";
import { useApiMutation } from "@/api/hooks";
import { queryKeys } from "@/api/query-keys";
import { useAppForm } from "@/components/ui/form/tanstack";
import { firstErrorMessage } from "@/components/ui/form/tanstack/error-message";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { useConfirm } from "@/providers/confirm-provider";
import { type BankFormValues, bankFormDefaults, bankFormSchema, parseBankForm } from "./bank-form";
import {
  answerLabels,
  type BankEntry,
  categoryLabels,
  intentLabels,
  privateMutationOptions,
  scopeLabels,
} from "./bank-options";

interface EntryDialogProps {
  entry?: BankEntry;
  onClose(): void;
}
export function EntryDialog({ entry, onClose }: EntryDialogProps): ReactElement {
  const confirm = useConfirm();
  const save = useApiMutation(
    (values: BankFormValues) => {
      const definition = parseBankForm(values);
      if (entry)
        return api["information-bank"]({ id: entry.id }).patch({
          expectedVersion: entry.version,
          definition,
        });
      return api["information-bank"].post(definition);
    },
    {
      ...privateMutationOptions,
      showErrorToast: false,
      invalidate: [queryKeys.informationBank.all],
      onSuccess: onClose,
    },
  );
  const form = useAppForm({
    defaultValues: bankFormDefaults(entry),
    validators: { onSubmit: bankFormSchema },
    onSubmit: async ({ value }) => {
      try {
        await save.mutateAsync(value);
      } catch {
        /* Keep the draft and error visible. */
      }
    },
  });
  const pristine = useSelector(form.store, (state) => state.isDefaultValue);
  const kind = useSelector(form.store, (state) => state.values.kind);
  const scope = useSelector(form.store, (state) => state.values.scope);
  useUnsavedChangesGuard(!pristine);
  const close = async () => {
    if (
      pristine ||
      (await confirm({
        title: "Discard unsaved answer edits?",
        description: "These edits have not been saved.",
        confirmLabel: "Discard",
      }))
    )
      onClose();
  };
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={save.isPending ? undefined : close}>
      <DialogTitle>
        {entry ? "Edit answer — approval will be cleared" : "New draft answer"}
      </DialogTitle>
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          form.handleSubmit();
        }}
      >
        <DialogContent>
          <Stack spacing={2}>
            <Alert severity="info">
              Only provide facts you know. Do not store passwords, one-time codes, government IDs,
              or payment credentials.
            </Alert>
            <form.AppField name="question">
              {(field) => (
                <field.TextField label="Exact application question" fullWidth multiline />
              )}
            </form.AppField>
            <form.AppField name="aliasesText">
              {(field) => (
                <field.TextField
                  label="Equivalent wordings you have reviewed"
                  helperText="Optional, one wording per line. Approval covers these exact meanings too."
                  fullWidth
                  multiline
                />
              )}
            </form.AppField>
            <form.Field name="intent">
              {(field) => (
                <TextField
                  label="Question meaning"
                  select
                  fullWidth
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  error={field.state.meta.errors.length > 0}
                  helperText={firstErrorMessage(field.state.meta.errors)}
                  onChange={(event) => {
                    const intent = ANSWER_INTENTS.find((value) => value === event.target.value);
                    if (!intent) return;
                    field.handleChange(intent);
                    if (isSensitiveIntent(intent)) {
                      form.setFieldValue("scope", "job");
                      form.setFieldValue("scopeKey", "");
                    }
                  }}
                >
                  {ANSWER_INTENTS.map((value) => (
                    <MenuItem key={value} value={value}>
                      {intentLabels[value]}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </form.Field>
            <form.AppField name="category">
              {(field) => (
                <field.Select
                  label="Category"
                  items={ANSWER_CATEGORIES.map((value) => ({
                    value,
                    label: categoryLabels[value],
                  }))}
                />
              )}
            </form.AppField>
            <form.AppField name="kind">
              {(field) => (
                <field.Select
                  label="Answer type"
                  items={Object.entries(answerLabels).map(([value, label]) => ({ value, label }))}
                />
              )}
            </form.AppField>
            {(kind === "choice" || kind === "multiple_choice") && (
              <form.AppField name="optionsText">
                {(field) => (
                  <field.TextField
                    label="Available choices"
                    helperText="Copy the exact available choices, one per line. Include a decline option only if offered."
                    fullWidth
                    multiline
                  />
                )}
              </form.AppField>
            )}
            <form.AppField name="answerText">
              {(field) =>
                kind === "boolean" ? (
                  <field.Select
                    label="Your answer"
                    items={[
                      { value: "true", label: "Yes" },
                      { value: "false", label: "No" },
                    ]}
                  />
                ) : (
                  <field.TextField
                    label="Your answer"
                    fullWidth
                    type={kind === "date" ? "date" : "text"}
                    multiline={kind === "text" || kind === "multiple_choice"}
                    helperText={
                      kind === "multiple_choice" ? "One selected choice per line." : undefined
                    }
                  />
                )
              }
            </form.AppField>
            <form.AppField name="scope">
              {(field) => (
                <field.Select
                  label="Where this answer may be reused"
                  items={ANSWER_SCOPES.map((value) => ({ value, label: scopeLabels[value] }))}
                />
              )}
            </form.AppField>
            {scope !== "global" && (
              <form.AppField name="scopeKey">
                {(field) => (
                  <field.TextField
                    label={
                      scope === "job" ? "Exact HTTPS job URL" : "Exact role or company identifier"
                    }
                    helperText="Sensitive answers require one exact job and a review date within seven days."
                    fullWidth
                  />
                )}
              </form.AppField>
            )}
            {save.error && (
              <Alert severity="error">
                {save.error.message} Your edits are retained. Close and reload the latest entry
                before resolving a version conflict.
              </Alert>
            )}
            {!pristine && <Typography variant="captionMuted">Unsaved changes</Typography>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={close} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={save.isPending}>
            Save draft
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
