"use client";

import { type ReactElement, useState } from "react";
import type { Preparation } from "@jobpilot/contracts/preparation";
import { Alert, Button, LinearProgress, MenuItem, Stack, TextField } from "@mui/material";
import { api } from "@/api/client";
import { useApiQuery } from "@/api/hooks";
import { resumeQueries } from "@/api/queries";
import { PaginationFooter } from "@/components/ui/data/pagination-footer";
import { SectionCard } from "@/components/ui/layout";
import { usePaginationParams } from "@/hooks/use-pagination";

interface DiscoveredJobPickerProps {
  userId: string;
  pending: boolean;
  preparations: Preparation[];
  onOpen(id: string): void;
  onPrepare(input: { ingestionRunId: string; sourceId: string; resumeId?: string }): void;
}

export function DiscoveredJobPicker(props: DiscoveredJobPickerProps): ReactElement {
  const { userId, pending, preparations, onOpen, onPrepare } = props;
  const pagination = usePaginationParams({ prefix: "prepare-jobs", pageSize: 10 });
  const [runId, setRunId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [resumeId, setResumeId] = useState("");
  const resumes = useApiQuery(resumeQueries.list(), { retry: false, gcTime: 0 });
  const runs = useApiQuery(
    {
      queryKey: ["preparation-discovery", userId, pagination.query],
      queryFn: () => api.integrations.n8n.runs.get({ query: pagination.query }),
    },
    { retry: false, gcTime: 0, networkMode: "always" },
  );
  const selectedRun = runs.data?.items.find((run) => run.id === runId);
  const selectedJob = selectedRun?.batch.jobs.find((job) => job.sourceId === sourceId);
  const existing =
    selectedJob &&
    preparations.find(
      (item) => item.job.sourceId === selectedJob.sourceId || item.job.url === selectedJob.url,
    );
  return (
    <SectionCard
      title="Choose a discovered job"
      description="Preparation uses stored structured discovery data and current approved resume versions."
    >
      <Stack spacing={2}>
        {runs.isError && (
          <Alert severity="error">Could not load discovery. {runs.error?.message}</Alert>
        )}
        {!runs.data && !runs.isError && <LinearProgress aria-label="Loading discovered jobs" />}
        {runs.data && (
          <>
            <TextField
              select
              fullWidth
              label="Discovery batch"
              value={runId}
              disabled={pending}
              onChange={(event) => {
                setRunId(event.target.value);
                setSourceId("");
              }}
            >
              <MenuItem value="">Choose a batch</MenuItem>
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
                setSourceId("");
                pagination.setPage(next);
              }}
            />
            {!runs.data.items.length && (
              <Alert severity="info">
                No structured discovery batches are available. External integrations remain
                disabled.
              </Alert>
            )}
          </>
        )}
        {selectedRun && (
          <TextField
            select
            fullWidth
            label="Job to prepare"
            value={sourceId}
            disabled={pending}
            onChange={(event) => setSourceId(event.target.value)}
          >
            <MenuItem value="">Choose a job</MenuItem>
            {selectedRun.batch.jobs.map((job) => (
              <MenuItem key={job.sourceId} value={job.sourceId}>
                {job.title} · {job.company}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField
          select
          fullWidth
          label="Resume for manual selection"
          helperText="Only used when your saved Auto-Apply Settings require manual selection. Automatic and fixed selection follow the saved policy."
          value={resumeId}
          disabled={pending}
          onChange={(event) => setResumeId(event.target.value)}
        >
          <MenuItem value="">Use saved resume selection</MenuItem>
          {resumes.data
            ?.filter((resume) => resume.active && resume.approved)
            .map((resume) => (
              <MenuItem key={resume.id} value={resume.id}>
                {resume.label} · version {resume.version}
              </MenuItem>
            ))}
        </TextField>
        {existing && (
          <Alert severity="info">
            This job already has a {existing.status} preparation. Open it to review the existing
            record; duplicate protection remains active.
          </Alert>
        )}
        <Button
          variant="contained"
          disabled={!selectedJob || pending}
          onClick={() => {
            if (existing) {
              onOpen(existing.id);
              return;
            }
            if (selectedJob)
              onPrepare({
                ingestionRunId: runId,
                sourceId: selectedJob.sourceId,
                ...(resumeId && { resumeId }),
              });
          }}
        >
          {existing ? "Open existing preparation" : "Prepare dry-run application"}
        </Button>
      </Stack>
    </SectionCard>
  );
}
