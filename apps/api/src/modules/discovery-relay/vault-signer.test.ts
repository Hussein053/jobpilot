import { generateKeyPairSync, sign, verify } from "node:crypto";
import { z } from "zod/v4";
import { VaultTransitSigner } from "./vault-signer";
import { expect, test } from "bun:test";

const config = {
  origin: "https://vault.example.test/",
  keyName: "fixture-discovery",
  keyVersion: 2,
};
test("the managed signer sends exact unprehashed bytes to one fixed key and verifies externally", async () => {
  const keys = generateKeyPairSync("ed25519");
  const signer = new VaultTransitSigner(config, async (url, init) => {
    expect(String(url)).toBe("https://vault.example.test/v1/transit/sign/fixture-discovery");
    expect(init?.redirect).toBe("error");
    const body = z
      .strictObject({ input: z.string(), key_version: z.literal(2), prehashed: z.literal(false) })
      .parse(JSON.parse(String(init?.body)));
    const signature = sign(null, Buffer.from(body.input, "base64"), keys.privateKey).toString(
      "base64",
    );
    return Response.json({ data: { signature: `vault:v2:${signature}` } });
  });
  const message = Buffer.from("synthetic domain-separated fixture");
  expect(verify(null, message, keys.publicKey, await signer.sign(message))).toBe(true);
});
test("key-version mismatch, malformed signatures, unavailable vault and unsafe targets fail closed", async () => {
  for (const signature of ["vault:v1:" + Buffer.alloc(64).toString("base64"), "vault:v2:bad"])
    await expect(
      new VaultTransitSigner(config, async () => Response.json({ data: { signature } })).sign(
        Buffer.from("fixture"),
      ),
    ).rejects.toThrow("auth_stopped");
  await expect(
    new VaultTransitSigner(config, async () => {
      throw Error("secret diagnostic");
    }).sign(Buffer.from("fixture")),
  ).rejects.toThrow("auth_stopped");
  expect(
    () => new VaultTransitSigner({ ...config, origin: "http://vault.example.test/" }, fetch),
  ).toThrow();
  expect(() => new VaultTransitSigner({ ...config, keyName: "../export/key" }, fetch)).toThrow();
});
