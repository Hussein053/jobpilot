import { previewHandler } from "./preview-gateway";
import { describe, expect, test } from "bun:test";

const origin = "https://synthetic-preview.trycloudflare.com";
const state = () => ({
  origin,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  mode: "DRY_RUN",
  liveSubmissionsEnabled: false,
  unrestrictedAgentsEnabled: false,
});
const request = (path: string, init?: RequestInit) =>
  new Request(`http://127.0.0.1:4190${path}`, init);

describe("temporary HTTPS preview gateway", () => {
  test("fails closed for missing, expired and live execution states", async () => {
    for (const value of [
      null,
      {},
      { ...state(), mode: "LIVE" },
      { ...state(), liveSubmissionsEnabled: true },
    ])
      expect((await previewHandler(async () => value)(request("/login"))).status).toBe(503);
    expect(
      (
        await previewHandler(async () => ({ ...state(), expiresAt: new Date(0).toISOString() }))(
          request("/login"),
        )
      ).status,
    ).toBe(410);
  });
  test("blocks new accounts, external integrations, credentials and disguised routes", async () => {
    const handler = previewHandler(async () => state());
    for (const path of [
      "/api/auth/register",
      "/api/auth/password/reset",
      "/api/integrations/n8n/ingest",
      "/api/credentials/",
      "/api/auth/%72egister",
    ])
      expect(
        (await handler(request(path, { method: "POST", headers: { origin } }))).status,
      ).toBeGreaterThanOrEqual(400);
  });
  test("rejects cross-origin or origin-less mutations before reaching an upstream", async () => {
    const handler = previewHandler(async () => state());
    for (const headers of [new Headers(), new Headers({ origin: "https://attacker.invalid" })])
      expect(
        (await handler(request("/api/preparations", { method: "POST", headers }))).status,
      ).toBe(403);
  });
  test("uses fixed loopback upstreams, preserves secure cookies and rewrites local redirects", async () => {
    const calls: string[] = [];
    const handler = previewHandler(async () => state(), (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      calls.push(String(url));
      expect(new Headers(init?.headers).get("x-forwarded-proto")).toBe("https");
      return new Response(null, {
        status: 307,
        headers: {
          location: "http://localhost:4100/login",
          "set-cookie": "session=synthetic; Secure; HttpOnly; SameSite=Lax; Path=/",
        },
      });
    }) as typeof fetch);
    const response = await handler(
      request("/api/auth/login", { method: "POST", headers: { origin } }),
    );
    await handler(request("/preparation"));
    expect(calls).toEqual([
      "http://127.0.0.1:4101/api/auth/login",
      "http://127.0.0.1:4100/preparation",
    ]);
    expect(response.headers.get("location")).toBe(`${origin}/login`);
    expect(response.headers.get("set-cookie")).toContain("Secure; HttpOnly");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
