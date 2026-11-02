import { createHmac } from "node:crypto";
import { inject, injectable } from "@needle-di/core";
import { HOUR_MS } from "@/common/date/buckets";
import { MemoryCache } from "@/common/memory-cache";
import { env } from "@/env";
import { PrismaClient } from "@/generated/prisma/client";
import type { SecretContext } from "./contexts";
import { KeyUnrecoverableError } from "./errors";
import { decrypt, encrypt, generateDek, unwrapDek, wrapDek } from "./secret";

const MASTER_KEY = Buffer.from(env.SECRET_MASTER_KEY, "base64");

/**
 * Per-user, at-rest encryption of secret column values. Each user owns a random
 * Data Encryption Key (DEK) stored wrapped under the master key on `User.wrappedDek`;
 * the DEK encrypts that user's secrets (board logins, captcha keys, Gmail tokens).
 * Deleting the user drops the wrapped DEK, crypto-shredding their secrets.
 */
@injectable()
export class CryptoService {
  /**
   * Unwrapped DEKs per user. Bounded and expiring so a deleted user's key leaves memory; a shared
   * in-flight load also stops two first requests from provisioning two keys.
   */
  private readonly deks = new MemoryCache<string, Buffer>({ ttlMs: HOUR_MS, maxEntries: 1000 });

  constructor(private readonly prisma: PrismaClient = inject(PrismaClient)) {}

  private getDek(userId: string): Promise<Buffer> {
    return this.deks.getOrLoad(userId, async () => {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { wrappedDek: true },
      });
      if (!user) {
        throw new Error(`Cannot resolve encryption key: no user ${userId}`);
      }
      return user.wrappedDek ? this.unwrap(userId, user.wrappedDek) : this.provisionDek(userId);
    });
  }

  /** Unwrap a stored DEK, translating an AES-GCM auth failure into `KeyUnrecoverableError`. */
  private unwrap(userId: string, wrapped: string): Buffer {
    try {
      return unwrapDek(MASTER_KEY, wrapped);
    } catch (cause) {
      throw new KeyUnrecoverableError(userId, { cause });
    }
  }

  /** Generate, persist (wrapped), and return a new DEK for a user that lacks one. */
  private async provisionDek(userId: string): Promise<Buffer> {
    const dek = generateDek();
    // First-write-wins: a concurrent provision must not overwrite an already-used DEK.
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, wrappedDek: null },
      data: { wrappedDek: wrapDek(MASTER_KEY, dek) },
    });
    if (count === 0) {
      const winner = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { wrappedDek: true },
      });
      if (!winner?.wrappedDek) {
        throw new Error(`Cannot resolve encryption key: no user ${userId}`);
      }
      return this.unwrap(userId, winner.wrappedDek);
    }
    return dek;
  }

  async encryptFor(userId: string, ctx: SecretContext, plain: string): Promise<string> {
    return encrypt(await this.getDek(userId), ctx, plain);
  }

  async decryptFor(userId: string, ctx: SecretContext, blob: string): Promise<string> {
    return decrypt(await this.getDek(userId), ctx, blob);
  }

  async fingerprintFor(userId: string, ctx: SecretContext, value: string): Promise<string> {
    return createHmac("sha256", await this.getDek(userId))
      .update(`${ctx}\0${value}`, "utf8")
      .digest("hex");
  }

  /** Encrypt an optional secret column value, passing null/undefined/empty through unchanged. */
  encryptField(
    userId: string,
    ctx: SecretContext,
    value: string | null | undefined,
  ): Promise<string | null | undefined> {
    if (value == null || value === "") {
      return Promise.resolve(value);
    }
    return this.encryptFor(userId, ctx, value);
  }

  /** Decrypt a stored secret column value, passing null/empty through unchanged. */
  decryptField(userId: string, ctx: SecretContext, value: string | null): Promise<string | null> {
    return value ? this.decryptFor(userId, ctx, value) : Promise.resolve(value);
  }
}
