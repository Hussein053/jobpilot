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
import { queryKeys } from "@/api/query-keys";
import { PaginationFooter } from "@/components/ui/data/pagination-footer";
import { usePaginationParams } from "@/hooks/use-pagination";
import { answerText, privateQueryOptions } from "./bank-options";

interface HistoryDialogProps {
  userId: string;
  id: string;
  onClose(): void;
}
export function HistoryDialog({ userId, id, onClose }: HistoryDialogProps): ReactElement {
  const page = usePaginationParams({ prefix: "answerHistory", pageSize: 10 });
  const query = useApiQuery(
    {
      queryKey: queryKeys.informationBank.history(userId, id, page.page, page.pageSize),
      queryFn: () => api["information-bank"]({ id }).history.get({ query: page.query }),
    },
    privateQueryOptions,
  );
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>Answer history</DialogTitle>
      <DialogContent>
        {query.isLoading && <LinearProgress />}
        {query.isError && <Alert severity="error">Could not load history.</Alert>}
        <Stack spacing={2}>
          {query.data?.items.map((event) => (
            <Stack key={event.id} spacing={1}>
              <Typography variant="body2Strong">
                Version {event.version} · {event.action} ·{" "}
                {new Date(event.createdAt).toLocaleString()}
              </Typography>
              {event.definition ? (
                <>
                  <Typography variant="body2">{event.definition.question}</Typography>
                  <Typography
                    variant="body2"
                    sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {answerText(event.definition.answer)}
                  </Typography>
                </>
              ) : (
                <Typography variant="body2Muted">
                  Answer content was deleted; only audit metadata remains readable.
                </Typography>
              )}
            </Stack>
          ))}
        </Stack>
        {query.data && (
          <PaginationFooter pagination={query.data.pagination} onPageChange={page.setPage} />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
