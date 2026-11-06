"use client";

import type { ReactElement } from "react";
import type { RESUME_REVIEW_ACTIONS } from "@jobpilot/contracts/resume-review";
import { Alert, Button, Chip, Stack, Typography } from "@mui/material";
import { api } from "@/api/client";
import { useApiMutation } from "@/api/hooks";
import { queryKeys } from "@/api/query-keys";
import type { ResumeDto } from "@/api/types";
import { SectionCard } from "@/components/ui/layout";
import { useConfirm } from "@/providers/confirm-provider";

interface ResumeReviewCardProps {
  resume: ResumeDto;
}
export function ResumeReviewCard({ resume }: ResumeReviewCardProps): ReactElement {
  const confirm = useConfirm();
  const requestFor = (action: (typeof RESUME_REVIEW_ACTIONS)[number]) => ({
    id: resume.id,
    action,
    expectedVersion: resume.version,
    expectedReviewRevision: resume.reviewRevision,
  });
  const review = useApiMutation(
    ({ id, ...input }: ReturnType<typeof requestFor>) => api.resumes({ id }).review.post(input),
    {
      networkMode: "always",
      retry: false,
      invalidate: [queryKeys.resume.all, queryKeys.autoApply.all],
      successMessage: "Review recorded. Live submissions remain disabled.",
    },
  );
  return (
    <SectionCard
      title="Approval for preparation"
      description={`Approval applies only to saved version ${resume.version}. Save edits and review the saved preview before approving.`}
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1}>
          <Chip label={resume.active ? "Active" : "Inactive"} variant="outlined" />
          <Chip
            label={resume.approved ? "Current version approved" : "Review required"}
            color={resume.approved ? "success" : "warning"}
          />
        </Stack>
        <Typography variant="body2">
          Content edits and source replacement or removal invalidate approval. Choosing a primary
          resume does not approve it. Variants need their own review before use.
        </Typography>
        <Alert severity="info">
          DRY RUN: approval permits future preparation only. It cannot activate applications.
        </Alert>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Button
            variant="contained"
            disabled={
              review.isPending ||
              !resume.active ||
              resume.approved ||
              (!resume.content && !resume.sourceFilename)
            }
            onClick={async () => {
              const request = requestFor("approve");
              if (
                await confirm({
                  title: `Approve saved version ${request.expectedVersion}?`,
                  description:
                    "Confirm that you reviewed this saved resume and its source file. Unsaved edits are excluded. This does not authorize submission.",
                  confirmLabel: "Approve saved version",
                })
              )
                review.mutate(request);
            }}
          >
            Approve saved version
          </Button>
          <Button
            disabled={review.isPending || !resume.approved}
            onClick={() => review.mutate(requestFor("revoke"))}
          >
            Revoke approval
          </Button>
          <Button
            disabled={review.isPending}
            onClick={() => review.mutate(requestFor(resume.active ? "deactivate" : "activate"))}
          >
            {resume.active ? "Make inactive" : "Make active"}
          </Button>
        </Stack>
      </Stack>
    </SectionCard>
  );
}
