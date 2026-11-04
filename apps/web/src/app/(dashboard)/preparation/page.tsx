import { Suspense } from "react";
import { LinearProgress } from "@mui/material";
import type { Metadata } from "next";
import { PreparationWorkspace } from "@/components/features/preparation/preparation-workspace";
import { PageHeader, PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Dry-run application preparation" };

export default function PreparationPage() {
  return (
    <PageShell maxWidth="lg">
      <PageHeader
        title="Application preparation"
        description="Review approved documents, reusable answers, and exceptions before a confined simulation."
      />
      <Suspense fallback={<LinearProgress />}>
        <PreparationWorkspace />
      </Suspense>
    </PageShell>
  );
}
