"use client";

import { type ReactElement, useDeferredValue, useState } from "react";
import { ANSWER_CATEGORIES, ANSWER_STATUSES } from "@jobpilot/contracts/information-bank";
import {
  Alert,
  Button,
  LinearProgress,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useSearchParams } from "next/navigation";
import { api } from "@/api/client";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import { authQueries, resumeQueries } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import { PaginationFooter } from "@/components/ui/data/pagination-footer";
import { usePaginationParams } from "@/hooks/use-pagination";
import { useConfirm } from "@/providers/confirm-provider";
import {
  type BankEntry,
  categoryLabels,
  privateMutationOptions,
  privateQueryOptions,
} from "./bank-options";
import { EntryCard } from "./entry-card";
import { EntryDialog } from "./entry-dialog";
import { HistoryDialog } from "./history-dialog";

export function InformationBank(): ReactElement {
  const me = useApiQuery(authQueries.me(), {
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: "always",
  });
  if (me.isError)
    return <Alert severity="error">Sign in again to read your Information Bank.</Alert>;
  if (!me.data) return <LinearProgress />;
  return <BankContent key={me.data.id} userId={me.data.id} />;
}
function BankContent({ userId }: { userId: string }): ReactElement {
  const confirm = useConfirm();
  const search = useSearchParams();
  const page = usePaginationParams({ prefix: "answers", pageSize: 10 });
  const [words, setWords] = useState("");
  const deferredWords = useDeferredValue(words);
  const [editor, setEditor] = useState<{ entry?: BankEntry } | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [importResume, setImportResume] = useState("");
  const category = ANSWER_CATEGORIES.find((value) => value === search.get("answerCategory"));
  const status = ANSWER_STATUSES.find((value) => value === search.get("answerStatus"));
  const filters = { ...page.query, category, status, query: deferredWords || undefined };
  const query = useApiQuery(
    {
      queryKey: queryKeys.informationBank.list(userId, filters),
      queryFn: () => api["information-bank"].search.post(filters),
    },
    privateQueryOptions,
  );
  const resumes = useApiQuery(resumeQueries.list());
  const profileImport = useApiMutation(() => api["information-bank"]["import-profile"].post(), {
    ...privateMutationOptions,
    invalidate: [queryKeys.informationBank.all],
    successMessage: (data) =>
      `Created ${data.created} contact drafts; preserved ${data.skipped} existing or unsupported entries.`,
  });
  const resumeImport = useApiMutation(
    (id: string) => api["information-bank"]["import-resume"]({ id }).post(),
    {
      ...privateMutationOptions,
      invalidate: [queryKeys.informationBank.all],
      successMessage: (data) =>
        `Created ${data.created} contact drafts; preserved ${data.skipped} existing or unsupported entries.`,
    },
  );
  const exported = useApiMutation(() => api["information-bank"].export.get(), {
    ...privateMutationOptions,
    onSuccess: (data) => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "jobpilot-information-bank.json";
      link.click();
      URL.revokeObjectURL(url);
    },
  });
  return (
    <Stack spacing={3}>
      <Alert severity="warning">
        DRY RUN — NO APPLICATIONS WILL BE SUBMITTED. Answer approval applies only to the saved
        version and scope.
      </Alert>
      <Typography variant="body2">
        Answers and question history are encrypted on the server and are not saved for offline use.
        Imports create contact drafts only; they do not infer eligibility, years of experience,
        salary, or approval.
      </Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button variant="contained" onClick={() => setEditor({})}>
          New answer
        </Button>
        <Button disabled={profileImport.isPending} onClick={() => profileImport.mutate()}>
          Import profile contact drafts
        </Button>
        <Button
          disabled={exported.isPending}
          onClick={async () => {
            if (
              await confirm({
                title: "Export this account’s answers?",
                description:
                  "This downloads personal answers to your device. Keep the downloaded file private.",
                confirmLabel: "Download export",
              })
            )
              exported.mutate();
          }}
        >
          Export answers
        </Button>
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <TextField
          select
          fullWidth
          label="Resume for contact draft import"
          value={importResume}
          onChange={(event) => setImportResume(event.target.value)}
        >
          <MenuItem value="">Choose a structured resume</MenuItem>
          {resumes.data
            ?.filter((resume) => resume.hasData)
            .map((resume) => (
              <MenuItem key={resume.id} value={resume.id}>
                {resume.label}
              </MenuItem>
            ))}
        </TextField>
        <Button
          disabled={!importResume || resumeImport.isPending}
          onClick={() => resumeImport.mutate(importResume)}
        >
          Import resume contact drafts
        </Button>
      </Stack>
      <Tabs
        value={category ?? "all"}
        onChange={(_, value: string) =>
          page.setFilters({ answerCategory: value === "all" ? null : value })
        }
        variant="scrollable"
        scrollButtons="auto"
        aria-label="Answer categories"
      >
        <Tab value="all" label="All" />
        {ANSWER_CATEGORIES.map((value) => (
          <Tab key={value} value={value} label={categoryLabels[value]} />
        ))}
      </Tabs>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          label="Search question words"
          fullWidth
          value={words}
          onChange={(event) => {
            setWords(event.target.value);
            page.setFilters({});
          }}
          helperText="Search text stays out of browser-history and request URLs. Answer values are not indexed."
        />
        <TextField
          select
          label="Approval status"
          value={status ?? "all"}
          onChange={(event) =>
            page.setFilters({
              answerStatus: event.target.value === "all" ? null : event.target.value,
            })
          }
          fullWidth
        >
          <MenuItem value="all">All statuses</MenuItem>
          {ANSWER_STATUSES.map((value) => (
            <MenuItem key={value} value={value}>
              {value}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      {query.isLoading && <LinearProgress />}
      {query.isError && (
        <Alert severity="error">
          {query.error?.message ?? "Could not load answers."}{" "}
          <Button onClick={() => query.refetch()}>Retry</Button>
        </Alert>
      )}
      {!query.isError && query.data?.items.length === 0 && (
        <Typography variant="body2Muted">
          No matching answers. Add a draft or import contact suggestions.
        </Typography>
      )}
      {!query.isError &&
        query.data?.items.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            onEdit={(selected) => setEditor({ entry: selected })}
            onHistory={setHistoryId}
          />
        ))}
      {query.data && (
        <PaginationFooter pagination={query.data.pagination} onPageChange={page.setPage} />
      )}
      {editor && <EntryDialog entry={editor.entry} onClose={() => setEditor(null)} />}
      {historyId && (
        <HistoryDialog userId={userId} id={historyId} onClose={() => setHistoryId(null)} />
      )}
    </Stack>
  );
}
