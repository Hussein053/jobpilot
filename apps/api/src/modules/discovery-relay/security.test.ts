import { generateKeyPairSync, sign } from "node:crypto";
import { signedHeaders, verifyBatchSignature } from "@/modules/ingestion/signature";
import { DiscoveryRelay } from "./relay";
import {
  type RelayCapabilities,
  relayConfigSchema,
  retryAfter,
  signedRelayHeaders,
} from "./security";
import { expect, test } from "bun:test";

const keys = generateKeyPairSync("ed25519");
const config = {
  enabled: true,
  integrationId: crypto.randomUUID(),
  expectedSubject: "fixture-workload",
  publicKeyPem: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
  jobpilotOrigin: "https://jobpilot.example.test/",
};
function capabilities(subject: string | null = "fixture-workload") {
  let signed = 0;
  let requests = 0;
  const caps: RelayCapabilities = {
    authenticate: async () => subject,
    signer: {
      sign: async (message) => {
        signed++;
        return sign(null, message, keys.privateKey);
      },
    },
    jobpilotFetch: async () => {
      requests++;
      throw Error("Sensitive internal diagnostic");
    },
    providerFetch: async () => {
      requests++;
      throw Error("Sensitive internal diagnostic");
    },
  };
  return { caps, counts: () => ({ signed, requests }) };
}
const request = (body: unknown = { requestId: crypto.randomUUID(), trigger: "scheduled" }) =>
  new Request("https://relay.example.test/trigger", {
    method: "POST",
    headers: { "content-type": "application/json", "x-subject": "fixture-workload" },
    body: JSON.stringify(body),
  });
test("inactive or unbound relays make no requests or signatures", async () => {
  const f = capabilities();
  expect(
    (await new DiscoveryRelay({ ...config, enabled: false }, f.caps).handle(request())).status,
  ).toBe(503);
  expect((await new DiscoveryRelay(config).handle(request())).status).toBe(503);
  expect(f.counts()).toEqual({ signed: 0, requests: 0 });
});
test("a caller-supplied subject header cannot replace gateway authentication", async () => {
  const f = capabilities(null);
  expect((await new DiscoveryRelay(config, f.caps).handle(request())).status).toBe(401);
  expect(f.counts()).toEqual({ signed: 0, requests: 0 });
});
test("the relay is not an arbitrary signing or destination oracle", async () => {
  const f = capabilities();
  const relay = new DiscoveryRelay(config, f.caps);
  for (const extra of [
    { targetUrl: "https://evil.example.test" },
    { body: "arbitrary" },
    { userId: "spoof" },
    { privateKey: "forged" },
  ])
    expect(
      (
        await relay.handle(
          request({ requestId: crypto.randomUUID(), trigger: "scheduled", ...extra }),
        )
      ).status,
    ).toBe(422);
  expect(f.counts()).toEqual({ signed: 0, requests: 0 });
  await expect(
    signedRelayHeaders(config, f.caps, "/api/applications/submit", "{}"),
  ).rejects.toThrow();
});
test("only a pinned Ed25519 signer can sign and errors reveal no internal diagnostic", async () => {
  const f = capabilities();
  f.caps.signer = { sign: async () => Buffer.alloc(64) };
  const response = await new DiscoveryRelay(config, f.caps).handle(request());
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain("Sensitive");
  expect(f.counts().requests).toBe(0);
  expect(
    relayConfigSchema.safeParse({
      ...config,
      publicKeyPem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    }).success,
  ).toBe(false);
  for (const origin of [
    "http://example.test",
    "https://user:password@example.test",
    "https://example.test/path",
    "https://example.test/?token=value",
  ])
    expect(relayConfigSchema.safeParse({ ...config, jobpilotOrigin: origin }).success).toBe(false);
});
test("ingestion signatures preserve the existing exact-byte domain", async () => {
  const f = capabilities();
  const body = '{"fixture":true}';
  const headers = new Headers(
    await signedRelayHeaders(config, f.caps, "/api/integrations/n8n/ingest", body),
  );
  expect(
    verifyBatchSignature(signedHeaders(headers), Buffer.from(body), config.publicKeyPem),
  ).toMatch(/^[a-f0-9]{64}$/);
  expect(() =>
    verifyBatchSignature(signedHeaders(headers), Buffer.from(body + " "), config.publicKeyPem),
  ).toThrow();
  const discovery = new Headers(
    await signedRelayHeaders(config, f.caps, "/api/integrations/n8n/search/claim", body),
  );
  expect(() =>
    verifyBatchSignature(signedHeaders(discovery), Buffer.from(body), config.publicKeyPem),
  ).toThrow();
});
test("Retry-After accepts bounded delta or HTTP date values", () => {
  expect(retryAfter(new Response(null, { headers: { "retry-after": "9999999" } }))).toBe(604800);
  expect(retryAfter(new Response(null, { headers: { "retry-after": "90" } }))).toBe(90);
  expect(retryAfter(new Response(null, { headers: { "retry-after": "99999" } }))).toBe(99999);
  expect(
    retryAfter(
      new Response(null, {
        headers: { "retry-after": new Date(Date.now() + 60000).toUTCString() },
      }),
    ),
  ).toBeGreaterThanOrEqual(59);
  expect(retryAfter(new Response(null, { headers: { "retry-after": "invalid" } }))).toBeNull();
});

test("an unsafe remote execution mode stops before any provider request", async () => {
  const f = capabilities();
  let providerCalls = 0;
  f.caps.jobpilotFetch = async () =>
    Response.json({
      runtime: {
        submissionMode: "LIVE",
        liveSubmissionsEnabled: true,
        unrestrictedAgentsEnabled: true,
      },
      taskIds: [],
      deliveryIds: [],
    });
  f.caps.providerFetch = async () => {
    providerCalls++;
    return Response.json({});
  };
  const response = await new DiscoveryRelay(config, f.caps).handle(request());
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ status: "stopped", reason: "unsafe_response" });
  expect(providerCalls).toBe(0);
});
