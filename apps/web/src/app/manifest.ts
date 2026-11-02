import type { MetadataRoute } from "next";
import { surfaces } from "@/theme/palette";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    scope: "/",
    name: "JobPilot AI",
    short_name: "JobPilot",
    description:
      "Job discovery, resume preparation, and application tracking. Development runs in enforced dry-run mode with live submissions disabled.",
    start_url: "/settings/auto-apply",
    display: "standalone",
    background_color: surfaces.base,
    theme_color: surfaces.base,
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any", purpose: "any" },
      { src: "/icon-maskable.svg", type: "image/svg+xml", sizes: "any", purpose: "maskable" },
      // Raster fallbacks for platforms (iOS, older Android) that don't render SVG launcher icons.
      { src: "/icon-192.png", type: "image/png", sizes: "192x192", purpose: "any" },
      { src: "/icon-512.png", type: "image/png", sizes: "512x512", purpose: "any" },
    ],
  };
}
