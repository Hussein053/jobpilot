"use client";

import type { ReactElement } from "react";
import type { AutoApplyPreferences } from "@jobpilot/contracts/auto-apply";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Button,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import { useApiQuery } from "@/api/hooks";
import { autoApplyQueries } from "@/api/queries";
import { PaginationFooter } from "@/components/ui/data/pagination-footer";
import { SectionCard } from "@/components/ui/layout";
import { usePaginationParams } from "@/hooks/use-pagination";

const labels: Record<keyof AutoApplyPreferences, string> = {
  autoApplyRequested: "Automatic applications requested",
  minimumSalaryUSD: "Minimum annual salary (USD)",
  unlistedSalary: "Unlisted salary",
  roles: "Target roles",
  location: "Location",
  workArrangements: "Work arrangements",
  maxDailyApplications: "Daily cap",
  searchFrequency: "Search frequency",
  timeZone: "Timezone",
  runHours: "Local run hours",
  resumeSelection: "Resume selection",
  fixedResumeId: "Fixed resume",
  minimumMatchScore: "Minimum match score",
  approvalForExceptions: "Approval for exceptions",
};
function display(
  key: keyof AutoApplyPreferences,
  value: AutoApplyPreferences[keyof AutoApplyPreferences],
): string {
  if (value === null) return "None";
  if (key === "fixedResumeId") return "Specific resume selected";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  if (value === "three_times_daily") return "Three times daily";
  return String(value);
}

export function SettingsHistory(): ReactElement {
  const page = usePaginationParams({ prefix: "history", pageSize: 10 });
  const query = useApiQuery(autoApplyQueries.audit(page.query));
  return (
    <SectionCard
      title="Settings change history"
      description="Saved versions are recorded by the server. Unsaved edits create no history."
    >
      {query.isLoading && <LinearProgress />}
      {query.isError && (
        <Alert severity="error">
          Could not load history. <Button onClick={() => query.refetch()}>Retry</Button>
        </Alert>
      )}
      {query.data?.items.length === 0 && (
        <Typography variant="body2Muted">No saved changes yet.</Typography>
      )}
      {query.data?.items.map((event) => (
        <Accordion key={event.id}>
          <AccordionSummary>
            <Typography variant="body2Strong">
              Version {event.version} · {new Date(event.createdAt).toLocaleString()}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1}>
              {(Object.keys(labels) as (keyof AutoApplyPreferences)[])
                .filter(
                  (key) =>
                    !event.previousPreferences ||
                    JSON.stringify(event.previousPreferences[key]) !==
                      JSON.stringify(event.preferences[key]),
                )
                .map((key) => (
                  <Typography key={key} variant="body2">
                    {labels[key]}:{" "}
                    {event.previousPreferences &&
                      `${display(key, event.previousPreferences[key])} → `}
                    {display(key, event.preferences[key])}
                  </Typography>
                ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      ))}
      {query.data && (
        <PaginationFooter pagination={query.data.pagination} onPageChange={page.setPage} />
      )}
    </SectionCard>
  );
}
