"use client";

import { useEffect } from "react";

export function PwaSupport() {
  useEffect(() => {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
    // Registration is independent of notification permission and never reloads a dirty form.
    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .catch(() => undefined);
  }, []);
  return null;
}
