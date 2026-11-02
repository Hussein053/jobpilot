"use client";

import type { ReactElement } from "react";
import { Alert, Box, Button, Chip, Stack, Typography } from "@mui/material";
import { z } from "zod/v4";
import { api } from "@/api/client";
import { useApiMutation } from "@/api/hooks";
import { queryKeys } from "@/api/query-keys";
import { useAppForm } from "@/components/ui/form/tanstack";
import { SectionCard } from "@/components/ui/layout";
import { useConfirm } from "@/providers/confirm-provider";
import {
  answerText,
  type BankEntry,
  categoryLabels,
  intentLabels,
  privateMutationOptions,
  scopeLabels,
} from "./bank-options";

interface EntryCardProps {
  entry: BankEntry;
  onEdit(entry: BankEntry): void;
  onHistory(id: string): void;
}
export function EntryCard({ entry, onEdit, onHistory }: EntryCardProps): ReactElement {
  const confirm = useConfirm();
  const revoke = useApiMutation(
    ({ id, version }: { id: string; version: number }) =>
      api["information-bank"]({ id }).revoke.post({ expectedVersion: version }),
    { ...privateMutationOptions, invalidate: [queryKeys.informationBank.all] },
  );
  const remove = useApiMutation(
    ({ id, version }: { id: string; version: number }) =>
      api["information-bank"]({ id }).delete({ expectedVersion: version }),
    { ...privateMutationOptions, invalidate: [queryKeys.informationBank.all] },
  );
  const state = entry.status;
  let label: string = state;
  if (entry.status === "approved" && !entry.ready) label = "Review overdue";
  return (
    <SectionCard
      title={entry.definition.question}
      description={`${categoryLabels[entry.definition.category]} · ${intentLabels[entry.definition.intent]}`}
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
          <Chip label={label} color={entry.ready ? "success" : "warning"} />
          <Chip label={`Version ${entry.version}`} variant="outlined" />
          {entry.sensitive && (
            <Chip label="Sensitive — exact job only" color="warning" variant="outlined" />
          )}
        </Stack>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {answerText(entry.definition.answer)}
        </Typography>
        <Typography variant="body2">
          Scope: {scopeLabels[entry.definition.scope]}
          {entry.definition.scopeKey && ` — ${entry.definition.scopeKey}`}
        </Typography>
        {entry.definition.aliases.length > 0 && (
          <Typography variant="body2Muted">
            Reviewed equivalent wordings: {entry.definition.aliases.join("; ")}
          </Typography>
        )}
        <Typography variant="captionMuted">
          Source: {entry.source.kind.replaceAll("_", " ")}
          {entry.source.referenceVersion && `, resume version ${entry.source.referenceVersion}`}.
          Updated {new Date(entry.updatedAt).toLocaleString()}.
        </Typography>
        {entry.reviewDueAt && (
          <Typography variant="captionMuted">
            Review due: {new Date(entry.reviewDueAt).toLocaleString()}
          </Typography>
        )}
        <ApprovalForm key={`approval-${entry.version}`} entry={entry} />
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
          <Button onClick={() => onEdit(entry)}>Edit draft</Button>
          <Button
            disabled={revoke.isPending || entry.status !== "approved"}
            onClick={() => revoke.mutate({ id: entry.id, version: entry.version })}
          >
            Revoke / disable
          </Button>
          <Button onClick={() => onHistory(entry.id)}>History</Button>
          <Button
            color="error"
            disabled={remove.isPending}
            onClick={async () => {
              const target = { id: entry.id, version: entry.version };
              if (
                await confirm({
                  title: "Delete this answer?",
                  description:
                    "This removes the answer and makes its saved answer history unreadable in the app. Audit dates remain. Downloaded exports and backups have separate retention.",
                  confirmLabel: "Delete",
                  destructive: true,
                })
              )
                remove.mutate(target);
            }}
          >
            Delete
          </Button>
        </Stack>
      </Stack>
    </SectionCard>
  );
}
function ApprovalForm({ entry }: { entry: BankEntry }): ReactElement {
  const confirm = useConfirm();
  const approve = useApiMutation(
    ({
      id,
      expectedVersion,
      reviewDueAt,
    }: {
      id: string;
      expectedVersion: number;
      reviewDueAt: string;
    }) => api["information-bank"]({ id }).approve.post({ expectedVersion, reviewDueAt }),
    {
      ...privateMutationOptions,
      invalidate: [queryKeys.informationBank.all],
      showErrorToast: false,
    },
  );
  const form = useAppForm({
    defaultValues: {
      due: new Date(Date.now() + (entry.sensitive ? 3 : 30) * 86_400_000)
        .toISOString()
        .slice(0, 10),
    },
    validators: { onSubmit: z.object({ due: z.iso.date() }) },
    onSubmit: async ({ value }) => {
      const request = {
        id: entry.id,
        expectedVersion: entry.version,
        reviewDueAt: `${value.due}T00:00:00.000Z`,
      };
      if (
        await confirm({
          title: `Approve displayed answer version ${request.expectedVersion}?`,
          description:
            "Confirm that you reviewed the displayed answer, equivalent wordings, scope, and review date. This cannot authorize a job application submission.",
          confirmLabel: "Approve reviewed answer",
        })
      )
        approve.mutate(request);
    },
  });
  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <Stack spacing={1}>
        {entry.sensitive && entry.definition.scope !== "job" && (
          <Alert severity="warning">
            Edit this answer to specify one exact job before approving it.
          </Alert>
        )}
        {!entry.ready && (
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <form.AppField name="due">
              {(field) => (
                <field.TextField
                  label="Review due date (UTC)"
                  type="date"
                  helperText={
                    entry.sensitive
                      ? "Within seven days; exact job scope required."
                      : "Within ninety days."
                  }
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              )}
            </form.AppField>
            <Button
              type="submit"
              variant="outlined"
              disabled={approve.isPending || (entry.sensitive && entry.definition.scope !== "job")}
            >
              Approve reviewed answer
            </Button>
          </Stack>
        )}
        {approve.error && <Alert severity="error">{approve.error.message}</Alert>}
      </Stack>
    </Box>
  );
}
