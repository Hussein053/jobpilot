import { z } from "zod/v4";
import { boundedResponseJson, RelayFault } from "./security";

const configSchema = z.strictObject({
  origin: z.url().refine((value) => {
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
  mount: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .default("transit"),
  keyName: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  keyVersion: z.number().int().positive(),
});
const signatureSchema = z.object({
  data: z.object({ signature: z.string().regex(/^vault:v[1-9]\d*:[A-Za-z0-9+/]{86}==$/) }),
});

export class VaultTransitSigner {
  private readonly config;
  constructor(
    config: z.input<typeof configSchema>,
    private readonly authenticatedVaultFetch: (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>,
  ) {
    this.config = Object.freeze(configSchema.parse(config));
  }
  async sign(message: Uint8Array): Promise<Uint8Array> {
    if (message.byteLength > 4096) throw new RelayFault("invalid_request");
    try {
      const path = `/v1/${this.config.mount}/sign/${this.config.keyName}`;
      const response = await this.authenticatedVaultFetch(new URL(path, this.config.origin), {
        method: "POST",
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.timeout(10000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: Buffer.from(message).toString("base64"),
          key_version: this.config.keyVersion,
          prehashed: false,
        }),
      });
      if (!response.ok) throw new Error();
      const parsed = signatureSchema.parse(await boundedResponseJson(response, 8192));
      const [, version, signature] = parsed.data.signature.split(":");
      if (version !== `v${this.config.keyVersion}` || !signature) throw new Error();
      return Buffer.from(signature, "base64");
    } catch {
      throw new RelayFault("auth_stopped");
    }
  }
}
