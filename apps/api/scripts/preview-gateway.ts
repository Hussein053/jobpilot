import { z } from "zod/v4";

const stateSchema = z.strictObject({
  origin: z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      /^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname) &&
      url.origin === value
    );
  }),
  expiresAt: z.iso.datetime(),
  mode: z.literal("DRY_RUN"),
  liveSubmissionsEnabled: z.literal(false),
  unrestrictedAgentsEnabled: z.literal(false),
});

export function previewHandler(readState: () => Promise<unknown>, transport: typeof fetch = fetch) {
  return async (request: Request) => {
    try {
      const state = stateSchema.parse(await readState());
      if (Date.now() >= Date.parse(state.expiresAt))
        return Response.json({ error: "Preview expired" }, { status: 410 });
      const url = new URL(request.url);
      if (url.pathname.includes("%"))
        return Response.json({ error: "Encoded paths disabled in preview" }, { status: 400 });
      if (url.pathname === "/preview-status")
        return Response.json(
          { ...state, syntheticOnly: true },
          { headers: { "cache-control": "no-store" } },
        );
      const api = url.pathname.startsWith("/api/");
      if (api && /^\/api\/(auth\/(register|password|email)|credentials)(\/|$)/.test(url.pathname))
        return Response.json(
          {
            error:
              "External integrations and account provisioning are disabled in this synthetic preview",
          },
          { status: 403 },
        );
      if (
        api &&
        url.pathname.startsWith("/api/integrations/") &&
        !["GET", "HEAD"].includes(request.method)
      )
        return Response.json(
          { error: "Discovery delivery is disabled in this synthetic preview" },
          { status: 403 },
        );
      if (url.pathname.startsWith("/terminal-disabled"))
        return Response.json(
          { error: "Unrestricted terminal execution is disabled" },
          { status: 423 },
        );
      if (
        url.pathname.startsWith("/api/auth/providers") &&
        !["/api/auth/providers", "/api/auth/providers/"].includes(url.pathname)
      )
        return Response.json(
          { error: "External sign-in providers are disabled in this preview" },
          { status: 403 },
        );
      const origin = request.headers.get("origin");
      const unsafe = !["GET", "HEAD", "OPTIONS"].includes(request.method);
      if ((origin && origin !== state.origin) || (unsafe && origin !== state.origin))
        return Response.json({ error: "Same-origin preview requests required" }, { status: 403 });
      const upstream = api ? "http://127.0.0.1:4101" : "http://127.0.0.1:4100";
      const headers = new Headers(request.headers);
      const publicUrl = new URL(state.origin);
      for (const name of [
        "connection",
        "upgrade",
        "forwarded",
        "x-forwarded-for",
        "x-real-ip",
        "keep-alive",
        "proxy-connection",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
      ])
        headers.delete(name);
      headers.set("accept-encoding", "identity");
      headers.set("host", publicUrl.host);
      headers.set("x-forwarded-host", publicUrl.host);
      headers.set("x-forwarded-proto", "https");
      const ip = request.headers.get("cf-connecting-ip");
      if (ip && /^[a-fA-F0-9:.]+$/.test(ip)) headers.set("x-forwarded-for", ip);
      const response = await transport(`${upstream}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "manual",
        signal: request.signal,
      });
      const output = new Headers(response.headers);
      for (const name of ["connection", "upgrade", "keep-alive", "transfer-encoding", "trailer"])
        output.delete(name);
      output.set("strict-transport-security", "max-age=3600");
      output.set("referrer-policy", "no-referrer");
      output.set("x-content-type-options", "nosniff");
      output.set("x-frame-options", "DENY");
      output.set("x-robots-tag", "noindex, nofollow, noarchive");
      output.delete("x-powered-by");
      if (!url.pathname.startsWith("/_next/static/")) output.set("cache-control", "no-store");
      const location = output.get("location");
      if (location) {
        const target = new URL(location, state.origin);
        if (["127.0.0.1", "localhost"].includes(target.hostname))
          output.set("location", `${state.origin}${target.pathname}${target.search}${target.hash}`);
      }
      return new Response(response.body, { status: response.status, headers: output });
    } catch {
      return Response.json({ error: "Synthetic preview unavailable" }, { status: 503 });
    }
  };
}

if (import.meta.main) {
  const statePath = process.env.JOBPILOT_PREVIEW_STATE;
  if (!statePath) throw new Error("A verified preview state file is required.");
  Bun.serve({
    hostname: "127.0.0.1",
    port: 4190,
    maxRequestBodySize: 25 * 1024 * 1024,
    fetch: previewHandler(() => Bun.file(statePath).json()),
  });
  console.log(
    "Synthetic preview gateway listening on loopback:4190; unverified state fails closed.",
  );
}
