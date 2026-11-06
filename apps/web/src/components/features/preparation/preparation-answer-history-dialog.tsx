"use client";

import type { ReactElement } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import { api } from "@/api/client";
import { useApiQuery } from "@/api/hooks";
import {
  answerText,
  intentLabels,
  scopeLabels,
} from "@/components/features/information-bank/bank-options";

interface PreparationAnswerHistoryDialogProps {
  userId: string;
  preparationId: string;
  onClose(): void;
}

export function PreparationAnswerHistoryDialog({
  userId,
  preparationId,
  onClose,
}: PreparationAnswerHistoryDialogProps): ReactElement {
  const query = useApiQuery(
    {
      queryKey: ["preparations", userId, "answer-history", preparationId],
      queryFn: () =>
        api
          .preparations({ id: preparationId })
          ["answer-history"].get({ fetch: { cache: "no-store" } }),
    },
    {
      retry: false,
      gcTime: 0,
      networkMode: "always",
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>Historical answers used in simulation</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ overflowWrap: "anywhere" }}>
          <Alert severity="warning">
            Private historical values only. These copies do not authorize answer reuse or
            application submission. Current Information Bank approval must be checked for every
            future use.
          </Alert>
          {query.isLoading && <LinearProgress aria-label="Loading private historical answers" />}
          {query.isError && (
            <Alert severity="error">
              Could not load historical answers. Close this dialog and explicitly reopen it to try
              again.
            </Alert>
          )}
          {query.data && query.data.items.length === 0 && (
            <Alert severity="info">
              Reference-only history; no answer values archived. Older simulations have no archived
              values and are not backfilled from current answers.
            </Alert>
          )}
          {query.data?.items.map((item) => (
            <Stack
              key={item.id}
              spacing={1}
              sx={{ p: 2, border: 1, borderColor: "divider", borderRadius: 1 }}
            >
              <Typography variant="body2Strong">{item.question}</Typography>
              <Typography variant="caption">
                {intentLabels[item.intent]}
                {item.sensitive && " · sensitive"} · question {item.questionId}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                {answerText(item.answer)}
              </Typography>
              <Typography variant="caption">
                Archived Information Bank entry {item.entryId} · version {item.entryVersion}
              </Typography>
              <Typography variant="caption">
                Approved {new Date(item.approvedAt).toLocaleString()} · review due at capture{" "}
                {new Date(item.reviewDueAt).toLocaleString()}
              </Typography>
              <Typography variant="caption">
                Captured {new Date(item.capturedAt).toLocaleString()} · scope:{" "}
                {scopeLabels[item.scope]}
                {item.scopeKey && ` — ${item.scopeKey}`}
              </Typography>
              <Typography variant="caption">
                Source: {item.source.kind.replaceAll("_", " ")}
                {item.source.referenceId && ` · reference ${item.source.referenceId}`}
                {item.source.referenceVersion !== null &&
                  ` · version ${item.source.referenceVersion}`}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
