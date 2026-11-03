"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import type { simulatePolicySchema } from "@jobpilot/contracts/policy-preview";
import {
  Alert,
  Button,
  Chip,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { z } from "zod/v4";
import { api } from "@/api/client";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import { authQueries, resumeQueries } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import { PaginationFooter } from "@/components/ui/data/pagination-footer";
import { SectionCard } from "@/components/ui/layout";
import { usePaginationParams } from "@/hooks/use-pagination";
import { useConfirm } from "@/providers/confirm-provider";
import { policyReasonLabels } from "./policy-reasons";

const privateRead = { gcTime: 0, retry: false, networkMode: "always" as const };
type SimulationRequest = z.infer<typeof simulatePolicySchema>;

export function PolicyPreview(): ReactElement {
  const auth = useApiQuery(authQueries.me());
  if (auth.isError) return <Alert severity="error">Sign in again to view policy counts.</Alert>;
  if (!auth.data) return <LinearProgress aria-label="Loading policy account" />;
  return <PolicyPreviewContent key={auth.data.id} userId={auth.data.id} />;
}
function PolicyPreviewContent({ userId }: { userId: string }): ReactElement {
  const page = usePaginationParams({ prefix: "discovery", pageSize: 10 });
  const [runId, setRunId] = useState("");
  const [resumeId, setResumeId] = useState("");
  const [pending, setPending] = useState<SimulationRequest | null>(null);
  const confirm = useConfirm();
  const runs = useApiQuery(
    {
      queryKey: [...queryKeys.autoApply.all, userId, "discovery-runs", page.query],
      queryFn: () => api.integrations.n8n.runs.get({ query: page.query }),
    },
    privateRead,
  );
  const preview = useApiQuery(
    {
      queryKey: [...queryKeys.autoApply.all, userId, "preview", runId, resumeId],
      queryFn: () =>
        api["auto-apply"].preview.get({
          query: {
            ...(runId && { ingestionRunId: runId }),
            ...(resumeId && { resumeId }),
          },
        }),
    },
    { ...privateRead, refetchInterval: 60_000 },
  );
  const resumes = useApiQuery(resumeQueries.list());
  const simulation = useApiMutation(
    (input: SimulationRequest) => api["auto-apply"].simulations.post(input),
    {
      networkMode: "always",
      retry: false,
      gcTime: 0,
      showErrorToast: false,
      invalidate: [queryKeys.autoApply.all],
    },
  );
  const snapshot = preview.data;
  const recordedCurrent =
    simulation.isSuccess &&
    simulation.variables?.ingestionRunId === runId &&
    simulation.variables.expectedSettingsVersion === snapshot?.settingsVersion &&
    simulation.variables.resumeId === (resumeId || undefined);
  return (
    <SectionCard
      title="Policy preview and daily quota"
      description="Saved settings only. Preview reads data; recording a simulation never starts an application."
    >
      <Stack spacing={2}>
        {preview.isError && (
          <Alert severity="error">Could not load policy counts. {preview.error?.message}</Alert>
        )}
        {!snapshot && !preview.isError && <LinearProgress aria-label="Loading daily quota" />}
        {snapshot && (
          <>
            <Typography variant="body2">
              Saved settings version {snapshot.settingsVersion} · {snapshot.quota.date} ·{" "}
              {snapshot.quota.timeZone}
            </Typography>
            <Typography variant="body2">
              Recorded applications today: {snapshot.quota.recordedApplications}. Remaining actual
              quota: {snapshot.quota.remainingActual} of {snapshot.quota.cap}.
            </Typography>
            <Typography variant="body2">
              Dry-run reservations today: {snapshot.quota.dryRunReservations}. Remaining simulation
              capacity: {snapshot.quota.remainingSimulation}.
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Resets {new Date(snapshot.quota.resetsAt).toLocaleString()}. Recorded counts reflect
              existing application history, not new website verification. Simulations never count as
              submitted applications.
            </Typography>
          </>
        )}
        {runs.isError && (
          <Alert severity="warning">
            Discovery history could not be loaded. {runs.error?.message}
          </Alert>
        )}
        {runs.data && (
          <>
            <TextField
              select
              label="Discovery batch to preview"
              value={runId}
              onChange={(event) => {
                setRunId(event.target.value);
                simulation.reset();
              }}
              fullWidth
            >
              <MenuItem value="">Quota only</MenuItem>
              {runs.data.items.map((run) => (
                <MenuItem key={run.id} value={run.id}>
                  {new Date(run.createdAt).toLocaleString()} · {run.batch.jobs.length} jobs
                </MenuItem>
              ))}
            </TextField>
            <PaginationFooter
              pagination={runs.data.pagination}
              onPageChange={(next) => {
                setRunId("");
                simulation.reset();
                page.setPage(next);
              }}
            />
            {!runs.data.items.length && (
              <Alert severity="info">
                No discovered batches yet. Live n8n delivery remains disabled.
              </Alert>
            )}
          </>
        )}
        {snapshot?.settings.resumeSelection === "manual" && (
          <TextField
            select
            label="Approved resume for this preview"
            value={resumeId}
            onChange={(event) => {
              setResumeId(event.target.value);
              simulation.reset();
            }}
            fullWidth
          >
            <MenuItem value="">Choose an approved resume</MenuItem>
            {resumes.data
              ?.filter((resume) => resume.active && resume.approved)
              .map((resume) => (
                <MenuItem key={resume.id} value={resume.id}>
                  {resume.label} · version {resume.version}
                </MenuItem>
              ))}
          </TextField>
        )}
        {snapshot?.jobs.map((job) => (
          <Stack
            key={job.sourceId}
            spacing={1}
            sx={{
              p: 2,
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              overflowWrap: "anywhere",
            }}
          >
            <Typography variant="body2Strong">
              {job.title} · {job.company}
            </Typography>
            <Chip
              size="small"
              label={
                job.outcome.decision === "eligible_for_dry_run"
                  ? "Eligible for dry-run preparation only"
                  : job.outcome.decision
              }
              sx={{ alignSelf: "flex-start", maxWidth: "100%" }}
            />
            <Typography variant="body2">
              Match score:{" "}
              {job.outcome.matchScore === null ? "unavailable" : `${job.outcome.matchScore}/100`} ·
              threshold {job.outcome.matchThreshold}/100
            </Typography>
            {job.resume && (
              <Typography variant="caption">
                Approved resume: {job.resume.label} · version {job.resume.version}
              </Typography>
            )}
            {job.outcome.reasons.map((reason) => (
              <Typography key={reason} variant="body2">
                {policyReasonLabels[reason]}
              </Typography>
            ))}
          </Stack>
        ))}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Button onClick={() => preview.refetch()} disabled={preview.isFetching}>
            Refresh policy preview
          </Button>
          <Button
            variant="outlined"
            disabled={
              !runId ||
              !snapshot ||
              preview.isError ||
              preview.isFetching ||
              simulation.isPending ||
              recordedCurrent
            }
            onClick={async () => {
              if (!snapshot || !runId) return;
              const same =
                pending?.ingestionRunId === runId &&
                pending.expectedSettingsVersion === snapshot.settingsVersion &&
                pending.resumeId === (resumeId || undefined);
              const request = same
                ? pending
                : {
                    requestId: crypto.randomUUID(),
                    ingestionRunId: runId,
                    expectedSettingsVersion: snapshot.settingsVersion,
                    ...(resumeId && { resumeId }),
                  };
              setPending(request);
              if (
                await confirm({
                  title: "Record this dry-run simulation?",
                  description: `Uses saved settings version ${request.expectedSettingsVersion}. It records decisions and may reserve simulation capacity. It cannot submit or prepare a real application.`,
                  confirmLabel: "Record simulation",
                })
              )
                simulation.mutate(request);
            }}
          >
            Record simulation
          </Button>
        </Stack>
        {simulation.error && (
          <Alert severity="error">
            {simulation.error.message} Retry keeps the same request identity for these inputs.
          </Alert>
        )}
        {simulation.data && (
          <Alert severity="success">
            Simulation recorded for settings version {simulation.data.settingsVersion}.{" "}
            {
              simulation.data.jobs.filter((job) => job.outcome.decision === "eligible_for_dry_run")
                .length
            }{" "}
            dry-run reservations;{" "}
            {simulation.data.jobs.filter((job) => job.outcome.decision === "review").length} need
            review. No applications submitted.
          </Alert>
        )}
      </Stack>
    </SectionCard>
  );
}
