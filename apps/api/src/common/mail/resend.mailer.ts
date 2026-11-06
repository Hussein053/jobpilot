import { injectable } from "@needle-di/core";
import { Resend } from "resend";
import { logger } from "@/common/logger";
import { env } from "@/env";
import type { Mailer, MailMessage } from "./mailer";

/** Sends email through Resend. Bound to the {@link MAILER} token when RESEND_API_KEY is set. */
@injectable()
export class ResendMailer implements Mailer {
  private readonly client = new Resend(env.RESEND_API_KEY);

  async send({ to, subject, react }: MailMessage): Promise<void> {
    try {
      const { error } = await this.client.emails.send({ from: env.EMAIL_FROM, to, subject, react });
      if (error) throw new Error("Mail provider rejected the request");
    } catch {
      logger.error("Transactional email delivery failed");
      throw new Error("Transactional email delivery failed");
    }
  }
}
