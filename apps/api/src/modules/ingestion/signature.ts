import { createHash, createPublicKey, verify } from "node:crypto";
import { z } from "zod/v4";
import { unauthorized } from "@/common/errors/http.error";

const headersSchema = z.object({
  integrationId: z.uuid(),
  timestamp: z.string().regex(/^\d{10}$/),
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
});

export function signedHeaders(headers: Headers, now = Date.now()) {
  const parsed = headersSchema.safeParse({
    integrationId: headers.get("x-jobpilot-integration"),
    timestamp: headers.get("x-jobpilot-timestamp"),
    signature: headers.get("x-jobpilot-signature"),
  });
  if (!parsed.success || Math.abs(now - Number(parsed.data.timestamp) * 1000) > 300_000) {
    throw unauthorized("Invalid ingestion signature");
  }
  return parsed.data;
}

export function verifyBatchSignature(
  headers: ReturnType<typeof signedHeaders>,
  bytes: Uint8Array,
  publicKeyPem: string,
) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  const message = `jobpilot-ingestion-v1\nPOST\n/api/integrations/n8n/ingest\n${headers.integrationId}\n${headers.timestamp}\n${digest}`;
  verifySignedMessage(message, headers.signature, publicKeyPem);
  return digest;
}

export function verifySignedMessage(message: string, signature: string, publicKeyPem: string) {
  let valid = false;
  try {
    if (!publicKeyPem.trim().startsWith("-----BEGIN PUBLIC KEY-----")) throw new Error();
    const key = createPublicKey(publicKeyPem);
    valid =
      key.asymmetricKeyType === "ed25519" &&
      verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signature, "base64"));
  } catch {
    // Invalid key material never authenticates an integration.
  }
  if (!valid) throw unauthorized("Invalid ingestion signature");
}
