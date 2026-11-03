import { createHash, createPublicKey, verify } from "node:crypto";
import { MAX_DISCOVERY_RETRY_AFTER } from "@jobpilot/contracts/discovery";
import { z } from "zod/v4";

export const relayConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  integrationId: z.uuid(),
  expectedSubject: z.string().min(1).max(200),
  publicKeyPem: z
    .string()
    .min(1)
    .refine((value) => value.trim().startsWith("-----BEGIN PUBLIC KEY-----")),
  jobpilotOrigin: z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
    );
  }),
});
export interface RelayCapabilities {
  authenticate(request: Request): Promise<string | null>;
  signer: { sign(message: Uint8Array): Promise<Uint8Array> };
  jobpilotFetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  providerFetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}
export class RelayFault extends Error {
  constructor(
    readonly reason:
      | "inactive"
      | "unauthorized"
      | "invalid_request"
      | "auth_stopped"
      | "unsafe_response"
      | "transport_error",
  ) {
    super(reason);
  }
}
export async function signedRelayHeaders(
  config: z.infer<typeof relayConfigSchema>,
  capabilities: RelayCapabilities,
  path: string,
  body: string,
) {
  if (!config.enabled) throw new RelayFault("inactive");
  const allowed = ["claim", "work", "start", "freeze", "fail", "lease", "report"].map(
    (action) => `/api/integrations/n8n/search/${action}`,
  );
  const ingest = path === "/api/integrations/n8n/ingest";
  if (!ingest && !allowed.includes(path)) throw new RelayFault("invalid_request");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const digest = createHash("sha256").update(body).digest("hex");
  const domain = ingest ? "jobpilot-ingestion-v1" : "jobpilot-discovery-v1";
  const message = Buffer.from(
    `${domain}\nPOST\n${path}\n${config.integrationId}\n${timestamp}\n${digest}`,
  );
  let signature: Uint8Array;
  try {
    const key = createPublicKey(config.publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error();
    signature = await capabilities.signer.sign(message);
    if (signature.byteLength !== 64 || !verify(null, message, key, signature)) throw new Error();
  } catch {
    throw new RelayFault("auth_stopped");
  }
  return {
    "content-type": "application/json",
    "x-jobpilot-integration": config.integrationId,
    "x-jobpilot-timestamp": timestamp,
    "x-jobpilot-signature": Buffer.from(signature).toString("base64"),
  };
}
export async function boundedResponseJson(response: Response, max: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (
    !reader ||
    !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")
  )
    throw new RelayFault("unsafe_response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new RelayFault("unsafe_response");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new RelayFault("unsafe_response");
  }
}
export function retryAfter(response: Response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const parsed = /^\d+$/.test(raw) ? Number(raw) : Math.ceil((Date.parse(raw) - Date.now()) / 1000);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(MAX_DISCOVERY_RETRY_AFTER, parsed));
}
