import { injectable } from "@needle-di/core";
import { render } from "@react-email/render";
import { logger } from "@/common/logger";
import { env } from "@/env";
import type { Mailer, MailMessage } from "./mailer";

// Local development may log links; a production mail outage must not expose account tokens.
@injectable()
export class ConsoleMailer implements Mailer {
  async send({ to, subject, react }: MailMessage): Promise<void> {
    if (env.NODE_ENV === "production")
      throw new Error("Transactional email is unavailable; configure a mail provider.");
    const text = await render(react, { plainText: true });
    logger.info({ to, subject }, `[mail] would send "${subject}" to ${to}\n${text}`);
  }
}
