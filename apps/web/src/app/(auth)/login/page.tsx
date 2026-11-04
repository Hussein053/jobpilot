import type { ReactElement } from "react";
import { Alert } from "@mui/material";
import type { Metadata } from "next";
import { AuthCard, LoginForm } from "@/components/features/auth";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your JobPilot dashboard to run and track job-application campaigns.",
  alternates: { canonical: "/login" },
};

export default function LoginPage(): ReactElement {
  // The form reads its own OAuth error off the URL, so the whole page prerenders.
  return (
    <AuthCard title="Sign in" subtitle="Welcome back. Sign in to continue.">
      {process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "1" && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Temporary synthetic DRY_RUN preview. Use the supplied fixture account, not production
          credentials. No real applications are submitted.
        </Alert>
      )}
      <LoginForm />
    </AuthCard>
  );
}
