"use client";

import { type ReactElement, useEffect, useState } from "react";
import { Alert, Button, Stack, Typography } from "@mui/material";
import { SectionCard } from "@/components/ui/layout";

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallHelp(): ReactElement {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [online, setOnline] = useState(true);
  const [secure, setSecure] = useState(true);
  useEffect(() => {
    setSecure(window.isSecureContext);
    setInstalled(
      window.matchMedia("(display-mode: standalone)").matches ||
        ("standalone" in navigator && navigator.standalone === true),
    );
    setOnline(navigator.onLine);
    const capture = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallEvent);
    };
    const didInstall = () => {
      setInstalled(true);
      setPrompt(null);
    };
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", didInstall);
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", didInstall);
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
    };
  }, []);
  return (
    <SectionCard
      title="Install JobPilot"
      description="Use the same settings and review tools on iPhone and desktop."
    >
      <Stack spacing={2}>
        {!online && (
          <Alert severity="warning">
            You are offline. Reconnect before loading or saving preferences. Personal data is not
            cached for offline use.
          </Alert>
        )}
        {!secure && (
          <Alert severity="info">
            Installation and service workers require HTTPS or localhost.
          </Alert>
        )}
        {installed && (
          <Typography role="status" variant="body2">
            JobPilot is running as an installed app.
          </Typography>
        )}
        {!installed && (
          <Typography variant="body2">
            On iPhone: open in Safari, choose Share, then Add to Home Screen. On desktop: use the
            browser’s Install app menu.
          </Typography>
        )}
        {prompt && !installed && (
          <Button
            variant="outlined"
            onClick={async () => {
              await prompt.prompt();
              await prompt.userChoice;
              setPrompt(null);
            }}
          >
            Install app
          </Button>
        )}
        <Typography variant="captionMuted">
          Installing the PWA does not install a desktop worker or activate applications. Resume
          content, answers, and credentials remain online-only.
        </Typography>
      </Stack>
    </SectionCard>
  );
}
