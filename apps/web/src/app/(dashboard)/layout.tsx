import type { PropsWithChildren, ReactElement } from "react";
import { Alert, Box } from "@mui/material";
import { AppShell } from "@/components/layout";

export default function DashboardLayout(props: PropsWithChildren): ReactElement {
  const { children } = props;
  return (
    <AppShell>
      <Box
        sx={{
          minHeight: "100%",
          display: "flex",
          flexDirection: "column",
          py: { xs: 2, sm: 3 },
        }}
      >
        {process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "1" && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Temporary DRY_RUN preview with synthetic data. Do not enter personal details or
            production credentials. This preview expires automatically.
          </Alert>
        )}
        {children}
      </Box>
    </AppShell>
  );
}
