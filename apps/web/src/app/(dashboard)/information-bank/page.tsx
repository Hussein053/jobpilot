import { Suspense } from "react";
import { LinearProgress } from "@mui/material";
import type { Metadata } from "next";
import { InformationBank } from "@/components/features/information-bank/information-bank";
import { PageHeader, PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Application Information Bank" };
export default function InformationBankPage() {
  return (
    <PageShell maxWidth="lg">
      <PageHeader
        title="Application Information Bank"
        description="Review and approve your own answers for the right question, scope, and date."
      />
      <Suspense fallback={<LinearProgress />}>
        <InformationBank />
      </Suspense>
    </PageShell>
  );
}
