import { Suspense } from "react";
import { LinearProgress } from "@mui/material";
import type { Metadata } from "next";
import { AutoApplySettings } from "@/components/features/settings/auto-apply/auto-apply-settings";

export const metadata: Metadata = { title: "Auto-Apply Settings" };

export default function AutoApplySettingsPage() {
  return (
    <Suspense fallback={<LinearProgress />}>
      <AutoApplySettings />
    </Suspense>
  );
}
