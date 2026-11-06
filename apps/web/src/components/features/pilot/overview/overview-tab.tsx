"use client";

import type { ReactElement } from "react";
import { Alert, Grid, Skeleton, Stack, Typography } from "@mui/material";
import { api } from "@/api/client";
import { useApiQuery } from "@/api/hooks";
import { pilotQueries } from "@/api/queries";
import { LinkButton } from "@/components/ui/buttons";
import { SectionCard } from "@/components/ui/layout";
import { useTerminalHealth } from "../../agent-dock/use-terminal-health";
import { NeedsAttention } from "../attention/needs-attention";
import { JobAlertsPanel } from "../job-alerts/job-alerts-panel";
import { pilotMode } from "../pilot-status";
import { usePilotControls } from "../use-pilot-controls";
import { OrchestrationPanel } from "./orchestration-panel";
import { RecentActivity } from "./recent-activity";
import { PilotSetupChecklist } from "./setup-checklist";
import { StatusBar } from "./status-bar";
import { TaskListPreview } from "./task-list-preview";
import { TodayPanel } from "./today-panel";
import { useNextWake } from "./use-next-wake";

export function OverviewTab(): ReactElement {
  const policy = useApiQuery(
    { queryKey: ["execution-policy"], queryFn: () => api.execution.policy.get() },
    { retry: false, gcTime: 0, networkMode: "always" },
  );
  if (policy.data?.unrestrictedAgentsEnabled) return <PilotOverview />;
  return (
    <Stack spacing={3}>
      <Alert severity={policy.isError ? "error" : "warning"}>
        {policy.isError
          ? "Execution policy could not be verified. Agent execution stays disabled."
          : "Autonomous Pilot execution is disabled. Do not install an agent or connect a mailbox for this DRY_RUN MVP."}
      </Alert>
      <SectionCard title="Continue in Application Preparation">
        <Stack spacing={2}>
          <Typography>
            Review approved resumes and answers, approve exceptions, and record a synthetic
            simulation. No employer website is opened and no application is submitted.
          </Typography>
          <LinkButton href="/preparation" variant="contained">
            Open Application Preparation
          </LinkButton>
          <LinkButton href="/pilot/activity">Review existing Pilot activity</LinkButton>
        </Stack>
      </SectionCard>
    </Stack>
  );
}

function PilotOverview(): ReactElement {
  // Owned here so the status bar, checklist and diagram share one host poll and wake timer.
  const controls = usePilotControls();
  const { health, status } = useTerminalHealth(controls.isLoading);
  const stateQuery = useApiQuery(pilotQueries.state(), {
    errorMessage: "Failed to load pilot state",
  });
  const nextWakeAt = useNextWake(stateQuery.data ?? null);

  const state = stateQuery.data;
  if (stateQuery.isLoading || !state) {
    return (
      <Stack spacing={3}>
        <Skeleton variant="rounded" height={96} />
        <Skeleton variant="rounded" height={56} />
        <Skeleton variant="rounded" height={220} />
        <Skeleton variant="rounded" height={180} />
      </Stack>
    );
  }

  const pilot = status?.pilot ?? null;
  const mode = pilotMode(state, health, pilot);

  return (
    <Stack spacing={3}>
      <PilotSetupChecklist state={state} health={health} />
      <StatusBar
        state={state}
        controls={controls}
        health={health}
        pilot={pilot}
        mode={mode}
        nextWakeAt={nextWakeAt}
      />
      <JobAlertsPanel />
      <NeedsAttention />
      <OrchestrationPanel state={state} pilot={pilot} mode={mode} nextWakeAt={nextWakeAt} />
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 5 }}>
          <TodayPanel state={state} />
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          <TaskListPreview running={state.running} />
        </Grid>
      </Grid>
      <RecentActivity />
    </Stack>
  );
}
