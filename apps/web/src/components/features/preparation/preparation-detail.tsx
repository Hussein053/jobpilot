"use client";

import { type ReactElement, useState } from "react";
import type { Preparation } from "@jobpilot/contracts/preparation";
import { Alert, Button, Chip, Link, Stack, Typography } from "@mui/material";
import NextLink from "next/link";
import { intentLabels } from "@/components/features/information-bank/bank-options";
import { SectionCard } from "@/components/ui/layout";
import { useConfirm } from "@/providers/confirm-provider";
import { PreparationAnswerHistoryDialog } from "./preparation-answer-history-dialog";
import { preparationEvidenceLabel, questionReasonLabel } from "./preparation-labels";

interface PreparationDetailProps {
  preparation: Preparation;
  userId: string;
  pending: boolean;
  onRefresh(): void;
  onApprove(): void;
  onSimulate(): void;
}

export function PreparationDetail(props: PreparationDetailProps): ReactElement {
  const { preparation, userId, pending, onRefresh, onApprove, onSimulate } = props;
  const confirm = useConfirm();
  const [showAnswerHistory, setShowAnswerHistory] = useState(false);
  const complete = preparation.status === "simulated";
  return (
    <Stack spacing={3}>
      <SectionCard title={`${preparation.job.title} · ${preparation.job.company}`}>
        <Stack spacing={2} sx={{ overflowWrap: "anywhere" }}>
          <Chip label={preparation.status} sx={{ alignSelf: "flex-start" }} />
          <Typography variant="body2">
            Preparation {preparation.id} · revision {preparation.revision}
          </Typography>
          <Typography variant="body2">Synthetic job: {preparation.job.url}</Typography>
          {preparation.resume && (
            <Typography variant="body2">
              Approved resume: {preparation.resume.label} · version {preparation.resume.version} ·
              approval revision {preparation.resume.reviewRevision}
            </Typography>
          )}
          {!preparation.resume && (
            <Alert severity="warning">An approved, active resume is required.</Alert>
          )}
          <Typography variant="caption" color="text.secondary">
            Resume approval, approved answer versions, duplicate protection and quota are rechecked
            before simulation. A prepared snapshot never authorizes a live application.
          </Typography>
        </Stack>
      </SectionCard>
      <SectionCard
        title="Form questions and approved answer provenance"
        description="This confined synthetic form cannot open employer websites. Answer values stay protected; only approved references are shown."
      >
        <Stack spacing={2}>
          {preparation.questions.map((question) => (
            <Stack
              key={question.id}
              spacing={1}
              sx={{
                p: 2,
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                overflowWrap: "anywhere",
              }}
            >
              <Typography variant="body2Strong">{question.label}</Typography>
              <Typography variant="body2">
                {question.required ? "Required" : "Optional"} · {question.kind} · {question.status}
                {question.sensitive && " · sensitive: exact job approval required"}
              </Typography>
              <Typography variant="caption">
                Question meaning: {intentLabels[question.intent]}
              </Typography>
              <Typography variant="body2">{questionReasonLabel(question.reason)}</Typography>
              {question.entryId && (
                <Typography variant="caption">
                  Approved Information Bank entry {question.entryId} · version{" "}
                  {question.entryVersion}
                </Typography>
              )}
              {question.status === "review" && (
                <Link component={NextLink} href="/information-bank">
                  Review this exact question in the Information Bank
                </Link>
              )}
            </Stack>
          ))}
          {!complete && (
            <Button onClick={onRefresh} disabled={pending}>
              Refresh approved answers
            </Button>
          )}
        </Stack>
      </SectionCard>
      <SectionCard title="Exception review">
        <Stack spacing={2}>
          <Alert severity={preparation.exceptions.approved ? "success" : "warning"}>
            {preparation.exceptions.approved
              ? "Exceptions approved for this simulation revision."
              : "Explicit review is required before simulation."}
          </Alert>
          {preparation.exceptions.reasons.map((reason) => (
            <Typography key={reason} variant="body2">
              {reason}
            </Typography>
          ))}
          {!complete && (
            <Button
              variant="outlined"
              onClick={onApprove}
              disabled={pending || preparation.exceptions.approved}
            >
              Approve dry-run exceptions
            </Button>
          )}
          {!complete && (
            <Button
              variant="contained"
              onClick={onSimulate}
              disabled={pending || preparation.status !== "ready"}
            >
              Run confined simulation
            </Button>
          )}
        </Stack>
      </SectionCard>
      {preparation.simulation && (
        <SectionCard title="Simulation evidence">
          <Stack spacing={1}>
            <Alert severity="success">
              Simulation complete. No application was submitted. Final submission controls were
              blocked.
            </Alert>
            {preparation.simulation.evidence.map((item) => (
              <Typography key={item} variant="body2">
                {preparationEvidenceLabel(item)}
              </Typography>
            ))}
          </Stack>
        </SectionCard>
      )}
      {complete && (
        <Button
          variant="outlined"
          onClick={async () => {
            if (
              await confirm({
                title: "Reveal private historical answers?",
                description:
                  "This displays encrypted answer copies captured during this simulation, including sensitive answers. Review them in a private place. These historical values never grant permission to reuse an answer or submit an application.",
                confirmLabel: "Reveal historical answers",
              })
            )
              setShowAnswerHistory(true);
          }}
        >
          Review historical answers
        </Button>
      )}
      {complete && showAnswerHistory && (
        <PreparationAnswerHistoryDialog
          userId={userId}
          preparationId={preparation.id}
          onClose={() => setShowAnswerHistory(false)}
        />
      )}
      <SectionCard title="Audit history">
        <Stack spacing={1}>
          {preparation.audit.map((event) => (
            <Typography key={`${event.revision}-${event.kind}`} variant="body2">
              {new Date(event.at).toLocaleString()} · {event.kind} · revision {event.revision}
            </Typography>
          ))}
        </Stack>
      </SectionCard>
    </Stack>
  );
}
