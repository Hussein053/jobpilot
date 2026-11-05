"use client";

import { type ReactElement, useState } from "react";
import type { Preparation } from "@jobpilot/contracts/preparation";
import { Alert, Button, LinearProgress, Stack, Typography } from "@mui/material";
import { api } from "@/api/client";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import { authQueries } from "@/api/queries";
import { PaginationFooter } from "@/components/ui/data/pagination-footer";
import { SectionCard } from "@/components/ui/layout";
import { usePaginationParams } from "@/hooks/use-pagination";
import { useConfirm } from "@/providers/confirm-provider";
import { DiscoveredJobPicker } from "./discovered-job-picker";
import { PreparationDetail } from "./preparation-detail";

const privateOptions = { retry: false, gcTime: 0, networkMode: "always" as const };
const preparationKey = ["preparations"] as const;
interface CreateRequest {
  requestId: string;
  ingestionRunId: string;
  sourceId: string;
  resumeId?: string;
}
interface RevisionRequest {
  id: string;
  expectedRevision: number;
}

export function PreparationWorkspace(): ReactElement {
  const me = useApiQuery(authQueries.me(), privateOptions);
  if (me.isError)
    return <Alert severity="error">Sign in again to review application preparation.</Alert>;
  if (!me.data) return <LinearProgress aria-label="Loading preparation account" />;
  return <PreparationContent key={me.data.id} userId={me.data.id} />;
}

function PreparationContent({ userId }: { userId: string }): ReactElement {
  const confirm = useConfirm();
  const pagination = usePaginationParams({ prefix: "preparation", pageSize: 10 });
  const [selectedId, setSelectedId] = useState("");
  const [request, setRequest] = useState<CreateRequest | null>(null);
  const history = useApiQuery(
    {
      queryKey: [...preparationKey, userId, "history", pagination.query],
      queryFn: () => api.preparations.get({ query: pagination.query }),
    },
    privateOptions,
  );
  const detail = useApiQuery(
    {
      queryKey: [...preparationKey, userId, "detail", selectedId],
      queryFn: () => api.preparations({ id: selectedId }).get(),
    },
    { ...privateOptions, enabled: !!selectedId },
  );
  const create = useApiMutation((input: CreateRequest) => api.preparations.post(input), {
    ...privateOptions,
    invalidate: [preparationKey],
    showErrorToast: false,
    onSuccess: (data) => setSelectedId(data.id),
  });
  const review = useApiMutation(
    (input: RevisionRequest & { approveExceptions: boolean }) =>
      api.preparations({ id: input.id }).review.post({
        expectedRevision: input.expectedRevision,
        approveExceptions: input.approveExceptions,
      }),
    { ...privateOptions, invalidate: [preparationKey], showErrorToast: false },
  );
  const simulate = useApiMutation(
    (input: RevisionRequest) =>
      api
        .preparations({ id: input.id })
        .simulate.post({ expectedRevision: input.expectedRevision }),
    { ...privateOptions, invalidate: [preparationKey], showErrorToast: false },
  );
  const pending = create.isPending || review.isPending || simulate.isPending;
  const snapshot: Preparation | undefined = detail.data;
  const reviewRequest = async (approveExceptions: boolean) => {
    if (!snapshot) return;
    const captured = { id: snapshot.id, expectedRevision: snapshot.revision, approveExceptions };
    if (
      approveExceptions &&
      !(await confirm({
        title: "Approve exceptions for this dry-run preparation?",
        description:
          "Review every listed exception. This approval only permits a confined synthetic simulation; it does not verify qualifications or authorize a real application.",
        confirmLabel: "Approve dry-run exceptions",
      }))
    )
      return;
    review.mutate(captured);
  };
  return (
    <Stack spacing={3}>
      <Alert severity="warning">
        DRY_RUN MVP — no applications will be submitted. Unrestricted browser execution is disabled.
      </Alert>
      <Alert severity="info">
        External integrations remain disabled in this MVP. Preparation accepts synthetic .invalid
        jobs only and uses an internal fixture form. Employer websites cannot be opened.
      </Alert>
      <DiscoveredJobPicker
        userId={userId}
        pending={pending}
        onPrepare={(input) => {
          const same =
            request?.ingestionRunId === input.ingestionRunId &&
            request.sourceId === input.sourceId &&
            request.resumeId === input.resumeId;
          const captured = same ? request : { ...input, requestId: crypto.randomUUID() };
          setRequest(captured);
          review.reset();
          simulate.reset();
          create.mutate(captured);
        }}
      />
      {create.error && (
        <Alert severity="error">
          {create.error.message} Retrying the same job preserves the request identity.
        </Alert>
      )}
      {review.error && (
        <Alert severity="error">
          {review.error.message} Refresh the preparation before reviewing again.
        </Alert>
      )}
      {simulate.error && (
        <Alert severity="error">{simulate.error.message} No application has been submitted.</Alert>
      )}
      {selectedId && detail.isFetching && <LinearProgress aria-label="Loading preparation" />}
      {detail.isError && (
        <Alert severity="error">Could not load preparation. {detail.error?.message}</Alert>
      )}
      {snapshot && (
        <PreparationDetail
          key={snapshot.id}
          userId={userId}
          preparation={snapshot}
          pending={pending}
          onRefresh={() => reviewRequest(false)}
          onApprove={() => reviewRequest(true)}
          onSimulate={async () => {
            const captured = { id: snapshot.id, expectedRevision: snapshot.revision };
            if (
              await confirm({
                title: "Run a confined dry-run simulation?",
                description:
                  "The server rechecks approved sources and quota, simulates the fixture form, and records evidence. Final submission actions stay blocked.",
                confirmLabel: "Run simulation",
              })
            )
              simulate.mutate(captured);
          }}
        />
      )}
      <SectionCard
        title="Preparation history"
        description="Simulated records are separate from historical applications and are never marked submitted."
      >
        <Stack spacing={2}>
          <Button
            disabled={history.isFetching || pending}
            onClick={() => {
              history.refetch();
              if (selectedId) detail.refetch();
            }}
          >
            Refresh preparation history
          </Button>
          {history.isError && (
            <Alert severity="error">Could not load history. {history.error?.message}</Alert>
          )}
          {history.data?.items.map((item) => (
            <Stack
              key={item.id}
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ alignItems: { sm: "center" }, overflowWrap: "anywhere" }}
            >
              <Typography variant="body2" sx={{ flex: 1 }}>
                {item.job.title} · {item.job.company} · {item.status}
              </Typography>
              <Button
                disabled={pending}
                onClick={() => {
                  setSelectedId(item.id);
                  review.reset();
                  simulate.reset();
                }}
              >
                View preparation
              </Button>
            </Stack>
          ))}
          {history.data && !history.data.items.length && (
            <Typography variant="body2">No preparations yet.</Typography>
          )}
          {history.data && (
            <PaginationFooter
              pagination={history.data.pagination}
              onPageChange={pagination.setPage}
            />
          )}
        </Stack>
      </SectionCard>
    </Stack>
  );
}
